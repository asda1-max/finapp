from typing import List
from pathlib import Path
import json
import math

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import yfinance as yf

from backend.data import get_stock_data
from backend.decision_making import CagrResult, compute_cagr, evaluate_cagr_methods

app = FastAPI(title="Saham FastFetch API")


# Izinkan akses dari frontend Electron/Vite (dev & prod)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # boleh dibatasi ke origin tertentu nanti
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


DATA_JSON_PATH = Path(__file__).with_name("data.json")
CAGR_JSON_PATH = Path(__file__).with_name("cagr_data.json")


class TickerPayload(BaseModel):
    ticker: str


class CagrItem(BaseModel):
    ticker: str
    net_income: List[float]
    revenue: List[float]
    eps: List[float]


class CagrRequest(BaseModel):
    items: List[CagrItem]


class CagrDirectItem(BaseModel):
    ticker: str
    cagr_net_income: float
    cagr_revenue: float
    cagr_eps: float
    cagr_years: int = 5


class CagrDirectRequest(BaseModel):
    items: List[CagrDirectItem]


def _load_cagr_data() -> dict:
    if not CAGR_JSON_PATH.exists():
        return {}
    try:
        raw = json.loads(CAGR_JSON_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    items = raw.get("items") or {}
    if not isinstance(items, dict):
        return {}
    return items


def _save_cagr_data(items: dict) -> None:
    payload = {"items": items}
    CAGR_JSON_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _load_saved_tickers() -> List[str]:
    if not DATA_JSON_PATH.exists():
        return []
    try:
        raw = json.loads(DATA_JSON_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    tickers = raw.get("tickers") or []
    if not isinstance(tickers, list):
        return []
    return [str(t).strip() for t in tickers if str(t).strip()]


def _save_tickers(tickers: List[str]) -> None:
    DATA_JSON_PATH.write_text(json.dumps({"tickers": tickers}, indent=2), encoding="utf-8")


def _delete_ticker_entry(ticker: str) -> dict:
    """Hapus ticker dari data.json dan cagr_data.json."""

    t = (ticker or "").strip()
    if not t:
        return {
            "deleted": False,
            "ticker": "",
            "saved_tickers": _load_saved_tickers(),
        }

    # Hapus dari saved tickers
    saved = _load_saved_tickers()
    filtered = [x for x in saved if x != t]
    removed_saved = len(filtered) != len(saved)
    if removed_saved:
        _save_tickers(filtered)

    # Hapus dari CAGR records
    cagr_items = _load_cagr_data()
    removed_cagr = False
    if t in cagr_items:
        cagr_items.pop(t, None)
        _save_cagr_data(cagr_items)
        removed_cagr = True

    return {
        "deleted": bool(removed_saved or removed_cagr),
        "ticker": t,
        "removed_saved": removed_saved,
        "removed_cagr": removed_cagr,
        "saved_tickers": filtered,
    }


def _to_float_or_none(value):
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _has_annual_cagr(item: dict) -> bool:
    ni = item.get("net_income") or []
    rev = item.get("revenue") or []
    eps = item.get("eps") or []
    return isinstance(ni, list) and isinstance(rev, list) and isinstance(eps, list) and len(ni) >= 2 and len(rev) >= 2 and len(eps) >= 2


def _has_direct_cagr(item: dict) -> bool:
    n = _to_float_or_none(item.get("cagr_net_income"))
    r = _to_float_or_none(item.get("cagr_revenue"))
    e = _to_float_or_none(item.get("cagr_eps"))
    return n is not None and r is not None and e is not None


@app.get("/")
async def root():
    return {"message": "Saham FastFetch API. Gunakan /stocks dan /saved-tickers endpoint."}


@app.get("/stocks")
async def get_stocks(tickers: str = Query(
    ...,  # wajib diisi sekarang
    description="Daftar ticker dipisah koma, contoh: BBCA.JK,BBRI.JK",
)):
    """Ambil data saham sebagai JSON untuk daftar ticker tertentu.

    Frontend wajib mengirim query ?tickers=....
    """

    symbols: List[str] = [t.strip() for t in tickers.split(",") if t.strip()]

    df = get_stock_data(symbols)

    # Kembalikan list of dict agar mudah dikonsumsi frontend
    return df.to_dict(orient="records")


@app.get("/saved-tickers")
async def get_saved_tickers() -> dict:
    """Kembalikan daftar ticker yang sudah disimpan di data.json."""

    tickers = _load_saved_tickers()
    return {"tickers": tickers}


@app.post("/saved-tickers")
async def add_saved_ticker(payload: TickerPayload) -> dict:
    """Tambahkan satu ticker ke data.json jika belum ada."""

    ticker = payload.ticker.strip()
    if not ticker:
        return {"tickers": _load_saved_tickers()}

    tickers = _load_saved_tickers()
    if ticker not in tickers:
        tickers.append(ticker)
        _save_tickers(tickers)

    return {"tickers": tickers}


@app.delete("/entry/{ticker}")
async def delete_entry(ticker: str) -> dict:
    """Hapus satu entry ticker dari daftar saved + data CAGR."""

    return _delete_ticker_entry(ticker)


@app.post("/decision-cagr")
async def decision_cagr(request: CagrRequest) -> dict:
    """Hitung CAGR dan keputusan BUY/NO BUY dengan VIKOR, TOPSIS, SAW, AHP.

    Body contoh:
    {
      "items": [
        {
          "ticker": "BBCA.JK",
          "net_income": [..4 tahun..],
          "revenue": [...],
          "eps": [...]
        }
      ]
    }
    """

    # 1) Hitung CAGR per ticker + ambil data fundamental dari data.py
    results: List[CagrResult] = []
    existing = _load_cagr_data()

    tickers = [item.ticker.strip() or "-" for item in request.items]
    fundamentals_df = get_stock_data(tickers) if tickers else None
    fundamentals = fundamentals_df.to_dict(orient="records") if fundamentals_df is not None else []

    for idx, item in enumerate(request.items):
        t = item.ticker.strip() or "-"
        cagr_net = compute_cagr(item.net_income)
        cagr_rev = compute_cagr(item.revenue)
        cagr_eps = compute_cagr(item.eps)
        # Annual mode: tampilkan kurun berdasarkan jumlah titik tahun input.
        # Contoh input 5 tahun data => cagr_years = 5 (bukan 4).
        years_span = max(len(item.net_income), len(item.revenue), len(item.eps))
        years_span = int(max(years_span, 0))

        fund = fundamentals[idx] if idx < len(fundamentals) else {}

        roe = float(fund.get("ROE (%)") or 0.0)
        mos = float(fund.get("MOS (%)") or 0.0)
        pbv = float(fund.get("PBV") or 0.0)
        div_yield = float(fund.get("Dividend Yield (%)") or 0.0)
        per = float(fund.get("PER NOW") or 0.0)
        down_from_high = float(fund.get("Down From High 52 (%)") or 0.0)

        results.append(
            CagrResult(
                ticker=t,
                cagr_net_income=cagr_net,
                cagr_revenue=cagr_rev,
                cagr_eps=cagr_eps,
                roe=roe,
                mos=mos,
                pbv=pbv,
                div_yield=div_yield,
                per=per,
                down_from_high=down_from_high,
            )
        )

        # Simpan data mentah annual ke JSON agar bisa diedit ulang tanpa ketik dari nol
        existing[t] = {
            "net_income": list(item.net_income),
            "revenue": list(item.revenue),
            "eps": list(item.eps),
            "cagr_net_income": cagr_net,
            "cagr_revenue": cagr_rev,
            "cagr_eps": cagr_eps,
            "cagr_years": years_span,
            "input_mode": "annual",
        }

    _save_cagr_data(existing)

    # Mode detailed page: gunakan CAGR penuh (data growth dari input user).
    return evaluate_cagr_methods(results, use_cagr=True)


@app.post("/decision-cagr-direct")
async def decision_cagr_direct(request: CagrDirectRequest) -> dict:
        """Hitung keputusan langsung dari nilai CAGR (tanpa input annual report).

        Body contoh:
        {
            "items": [
                {
                    "ticker": "BBCA.JK",
                    "cagr_net_income": 12.5,
                    "cagr_revenue": 9.1,
                    "cagr_eps": 14.0
                }
            ]
        }
        """

        results: List[CagrResult] = []
        existing = _load_cagr_data()

        tickers = [item.ticker.strip() or "-" for item in request.items]
        fundamentals_df = get_stock_data(tickers) if tickers else None
        fundamentals = fundamentals_df.to_dict(orient="records") if fundamentals_df is not None else []

        for idx, item in enumerate(request.items):
                t = item.ticker.strip() or "-"
                cagr_net = float(item.cagr_net_income)
                cagr_rev = float(item.cagr_revenue)
                cagr_eps = float(item.cagr_eps)
                cagr_years = int(item.cagr_years) if int(item.cagr_years) > 0 else 1

                fund = fundamentals[idx] if idx < len(fundamentals) else {}

                roe = float(fund.get("ROE (%)") or 0.0)
                mos = float(fund.get("MOS (%)") or 0.0)
                pbv = float(fund.get("PBV") or 0.0)
                div_yield = float(fund.get("Dividend Yield (%)") or 0.0)
                per = float(fund.get("PER NOW") or 0.0)
                down_from_high = float(fund.get("Down From High 52 (%)") or 0.0)

                results.append(
                        CagrResult(
                                ticker=t,
                                cagr_net_income=cagr_net,
                                cagr_revenue=cagr_rev,
                                cagr_eps=cagr_eps,
                                roe=roe,
                                mos=mos,
                                pbv=pbv,
                                div_yield=div_yield,
                                per=per,
                                down_from_high=down_from_high,
                        )
                )

                prev = existing.get(t) if isinstance(existing.get(t), dict) else {}
                existing[t] = {
                        # pertahankan annual raw lama jika ada
                        "net_income": (prev or {}).get("net_income") or [],
                        "revenue": (prev or {}).get("revenue") or [],
                        "eps": (prev or {}).get("eps") or [],
                        "cagr_net_income": cagr_net,
                        "cagr_revenue": cagr_rev,
                        "cagr_eps": cagr_eps,
                        "cagr_years": cagr_years,
                        "input_mode": "direct",
                }

        _save_cagr_data(existing)

        return evaluate_cagr_methods(results, use_cagr=True)


@app.get("/cagr-raw/{ticker}")
async def get_cagr_raw(ticker: str) -> dict:
    """Ambil data annual Net Income, Revenue, EPS yang pernah disimpan untuk ticker tertentu.

    Jika belum ada data, kembalikan array kosong.
    """

    items = _load_cagr_data()
    t = ticker.strip()
    data = items.get(t) or {}
    input_mode = data.get("input_mode") or "annual"

    years_val = data.get("cagr_years")
    if years_val is None and input_mode == "annual":
        years_val = max(
            len(data.get("net_income") or []),
            len(data.get("revenue") or []),
            len(data.get("eps") or []),
        )
        years_val = int(max(years_val, 0))

    # Normalisasi bentuk output
    return {
        "ticker": t,
        "net_income": data.get("net_income") or [],
        "revenue": data.get("revenue") or [],
        "eps": data.get("eps") or [],
        "cagr_net_income": data.get("cagr_net_income"),
        "cagr_revenue": data.get("cagr_revenue"),
        "cagr_eps": data.get("cagr_eps"),
        "cagr_years": years_val,
        "input_mode": input_mode,
    }


@app.get("/price-history")
async def get_price_history(
    ticker: str = Query(
        ...,
        description="Ticker saham, misal: BBCA.JK",
    ),
    period: str = Query(
        "1y",
        description="Periode data yfinance, contoh: 3mo,6mo,1y,2y,5y,max",
    ),
    interval: str = Query(
        "1wk",
        description="Interval data yfinance, contoh: 1d,1wk,1mo",
    ),
) -> dict:
    """Ambil histori harga saham (Close) dari yfinance.

    Default: 1 tahun terakhir dengan interval mingguan.
    Output berupa array tanggal dan harga penutupan.
    """

    t = (ticker or "").strip()
    if not t:
        return {"ticker": "", "period": period, "interval": interval, "dates": [], "close": []}

    try:
        stock = yf.Ticker(t)
        hist = stock.history(period=period, interval=interval)
    except Exception:
        return {"ticker": t, "period": period, "interval": interval, "dates": [], "close": []}

    if hist is None or hist.empty:
        return {"ticker": t, "period": period, "interval": interval, "dates": [], "close": []}

    dates: List[str] = []
    close: List[float] = []

    for idx, row in hist.iterrows():
        raw_price = row.get("Close")
        if raw_price is None:
            continue
        price = float(raw_price)
        if math.isnan(price):
            continue
        # idx adalah Timestamp tanggal
        dates.append(idx.strftime("%Y-%m-%d"))
        close.append(price)

    return {
        "ticker": t,
        "period": period,
        "interval": interval,
        "dates": dates,
        "close": close,
    }


@app.get("/ranking-data")
async def get_ranking_data() -> dict:
    """Kembalikan data ranking saham berdasarkan metode MCDM yang dipilih di frontend.

    - ranked: hanya ticker yang sudah punya input CAGR (annual/direct)
    - unranked: ticker tersimpan yang belum punya data CAGR lengkap
    """

    saved_tickers = _load_saved_tickers()
    cagr_items = _load_cagr_data()

    if not saved_tickers:
        return {
            "total_saved": 0,
            "ranked_count": 0,
            "unranked_count": 0,
            "ranked": [],
            "unranked": [],
        }

    fundamentals_df = get_stock_data(saved_tickers)
    fundamentals = fundamentals_df.to_dict(orient="records") if fundamentals_df is not None else []
    fund_by_ticker = {
        str(row.get("Ticker") or "").strip(): row
        for row in fundamentals
        if str(row.get("Ticker") or "").strip()
    }

    results: List[CagrResult] = []
    meta_by_ticker = {}
    unranked = []

    for t in saved_tickers:
        ticker = t.strip()
        raw = cagr_items.get(ticker) if isinstance(cagr_items.get(ticker), dict) else {}

        has_direct = _has_direct_cagr(raw)
        has_annual = _has_annual_cagr(raw)

        if not has_direct and not has_annual:
            name = str((fund_by_ticker.get(ticker) or {}).get("Name") or ticker)
            unranked.append({"ticker": ticker, "name": name, "reason": "CAGR belum diinput"})
            continue

        if has_direct:
            cagr_net = float(raw.get("cagr_net_income"))
            cagr_rev = float(raw.get("cagr_revenue"))
            cagr_eps = float(raw.get("cagr_eps"))
            input_mode = "direct"
            cagr_years = int(raw.get("cagr_years") or 0)
        else:
            cagr_net = compute_cagr(raw.get("net_income") or [])
            cagr_rev = compute_cagr(raw.get("revenue") or [])
            cagr_eps = compute_cagr(raw.get("eps") or [])
            input_mode = "annual"
            cagr_years = max(
                len(raw.get("net_income") or []),
                len(raw.get("revenue") or []),
                len(raw.get("eps") or []),
            )
            cagr_years = int(max(cagr_years, 0))

        fund = fund_by_ticker.get(ticker) or {}
        name = str(fund.get("Name") or ticker)

        roe = float(fund.get("ROE (%)") or 0.0)
        mos = float(fund.get("MOS (%)") or 0.0)
        pbv = float(fund.get("PBV") or 0.0)
        div_yield = float(fund.get("Dividend Yield (%)") or 0.0)
        per = float(fund.get("PER NOW") or 0.0)
        down_from_high = float(fund.get("Down From High 52 (%)") or 0.0)

        results.append(
            CagrResult(
                ticker=ticker,
                cagr_net_income=cagr_net,
                cagr_revenue=cagr_rev,
                cagr_eps=cagr_eps,
                roe=roe,
                mos=mos,
                pbv=pbv,
                div_yield=div_yield,
                per=per,
                down_from_high=down_from_high,
            )
        )

        meta_by_ticker[ticker] = {
            "name": name,
            "input_mode": input_mode,
                "cagr_years": cagr_years,
            "cagr": {
                "net_income": cagr_net,
                "revenue": cagr_rev,
                "eps": cagr_eps,
            },
        }

    if not results:
        return {
            "total_saved": len(saved_tickers),
            "ranked_count": 0,
            "unranked_count": len(unranked),
            "ranked": [],
            "unranked": unranked,
        }

    evaluated = evaluate_cagr_methods(results, use_cagr=True)
    methods = evaluated.get("methods", {})

    ranked = []
    method_keys = ["FUZZY_AHP_TOPSIS", "TOPSIS", "SAW", "AHP", "VIKOR"]
    for r in results:
        t = r.ticker
        meta = meta_by_ticker.get(t) or {}

        scores = {}
        for mk in method_keys:
            info = (methods.get(mk) or {}).get(t) or {}
            scores[mk] = {
                "score": info.get("score"),
                "decision": info.get("decision"),
                "category": info.get("category"),
            }

        ranked.append(
            {
                "ticker": t,
                "name": meta.get("name") or t,
                "input_mode": meta.get("input_mode") or "annual",
                "cagr_years": meta.get("cagr_years") or 0,
                "cagr": meta.get("cagr") or {},
                "scores": scores,
            }
        )

    return {
        "total_saved": len(saved_tickers),
        "ranked_count": len(ranked),
        "unranked_count": len(unranked),
        "ranked": ranked,
        "unranked": unranked,
    }
