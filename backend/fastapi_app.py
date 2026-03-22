from typing import List
from pathlib import Path
import json
import math
from datetime import datetime, timezone, date

from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import numpy as np
import yfinance as yf

from backend.data import get_stock_data
from backend.decision_making import (
    CagrResult,
    compute_cagr,
    evaluate_cagr_methods,
    _invalidate_thresholds_cache,
    _load_thresholds_cached,
)

app = FastAPI(title="Saham FastFetch API")


# Izinkan akses dari frontend Electron/Vite (dev & prod)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # boleh dibatasi ke origin tertentu nanti
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


import os

_data_dir_env = os.environ.get("FINAPP_DATA_DIR")
if _data_dir_env:
    _data_dir = Path(_data_dir_env)
    _data_dir.mkdir(parents=True, exist_ok=True)
    DATA_JSON_PATH = _data_dir / "data.json"
    CAGR_JSON_PATH = _data_dir / "cagr_data.json"
    THRESHOLDS_JSON_PATH = _data_dir / "thresholds.json"
else:
    DATA_JSON_PATH = Path(__file__).with_name("data.json")
    CAGR_JSON_PATH = Path(__file__).with_name("cagr_data.json")
    THRESHOLDS_JSON_PATH = Path(__file__).with_name("thresholds.json")


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


class CagrAutoItem(BaseModel):
    ticker: str


class CagrAutoRequest(BaseModel):
    items: List[CagrAutoItem]


class ResetPayload(BaseModel):
    confirmation: str


class ThresholdCalibrationRequest(BaseModel):
    horizon_days: int = 63
    target_return_pct: float = 8.0
    lookback_period: str = "5y"
    min_samples: int = 120
    save: bool = True


class HybridModeConfigPayload(BaseModel):
    weights: List[float]
    recommended: float
    buy: float
    risk: float


class HybridConfigPayload(BaseModel):
    use_cagr: HybridModeConfigPayload
    no_cagr: HybridModeConfigPayload


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


def _reset_all_entries() -> None:
    _save_tickers([])
    _save_cagr_data({})


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


def _normalize_numeric_series(series_like) -> List[float]:
    try:
        values = [float(x) for x in list(series_like) if x is not None and np.isfinite(float(x))]
    except Exception:
        return []
    return values


def _extract_year(value) -> int | None:
    if value is None:
        return None
    try:
        if hasattr(value, "year"):
            y = int(value.year)
            return y if 1900 <= y <= 2200 else None
        s = str(value)
        if len(s) >= 4 and s[:4].isdigit():
            y = int(s[:4])
            return y if 1900 <= y <= 2200 else None
    except Exception:
        return None
    return None


def _extract_financial_row_series(financials, candidates: List[str]) -> tuple[List[float], List[int]]:
    if financials is None:
        return [], []
    try:
        idx = list(financials.index)
    except Exception:
        return [], []

    for name in candidates:
        if name not in idx:
            continue
        try:
            row = financials.loc[name]
            row = row.sort_index()
            vals: List[float] = []
            years: List[int] = []
            for col, raw_val in row.items():
                v = _to_float_or_none(raw_val)
                if v is None or not np.isfinite(v):
                    continue
                y = _extract_year(col)
                vals.append(float(v))
                if y is not None:
                    years.append(int(y))
            if len(vals) >= 2:
                uniq_years = sorted({int(y) for y in years})
                return vals, uniq_years
        except Exception:
            continue
    return [], []


def _extract_eps_series(stock, financials) -> tuple[List[float], List[int]]:
    # Prioritas 1: EPS tahunan dari income statement bila tersedia.
    eps_from_fin, eps_years = _extract_financial_row_series(financials, ["Diluted EPS", "Basic EPS", "Normalized EPS"])
    if len(eps_from_fin) >= 2:
        return eps_from_fin, eps_years

    # Prioritas 2: ringkas earnings history kuartalan menjadi rerata EPS per tahun.
    try:
        eh = stock.earnings_history
    except Exception:
        eh = None

    if eh is None:
        return [], []

    try:
        if eh.empty or "epsActual" not in eh.columns:
            return [], []
    except Exception:
        return [], []

    try:
        df = eh.copy()
        if "asOfDate" in df.columns:
            years = np.array([d.year if not np.isnat(d) else None for d in np.array(df["asOfDate"], dtype="datetime64[ns]")])
        else:
            years = np.array([d.year for d in df.index])

        eps_vals = np.array(df["epsActual"], dtype=float)
        yearly = {}
        for y, v in zip(years, eps_vals):
            if y is None or not np.isfinite(v):
                continue
            yearly.setdefault(int(y), []).append(float(v))

        if len(yearly) < 2:
            return [], []

        out = []
        years_out = []
        for y in sorted(yearly.keys()):
            vals = yearly[y]
            if not vals:
                continue
            out.append(float(sum(vals) / len(vals)))
            years_out.append(int(y))
        return (out, years_out) if len(out) >= 2 else ([], [])
    except Exception:
        return [], []


def _extract_auto_cagr_payload(ticker: str) -> dict:
    symbol = (ticker or "").strip()
    if not symbol:
        return {
            "ticker": "",
            "net_income": [],
            "revenue": [],
            "eps": [],
            "cagr_net_income": 0.0,
            "cagr_revenue": 0.0,
            "cagr_eps": 0.0,
            "cagr_years": 0,
            "period_start_year": None,
            "period_end_year": None,
            "period_label": None,
            "period_source": "auto_annual_report",
            "input_mode": "auto",
        }

    stock = yf.Ticker(symbol)
    try:
        financials = stock.financials
    except Exception:
        financials = None

    ni, ni_years = _extract_financial_row_series(financials, ["Net Income", "NetIncome", "Net Income Common Stockholders"])
    rev, rev_years = _extract_financial_row_series(financials, ["Total Revenue", "TotalRevenue", "Operating Revenue"])
    eps, eps_years = _extract_eps_series(stock, financials)

    cagr_net = compute_cagr(ni)
    cagr_rev = compute_cagr(rev)
    cagr_eps = compute_cagr(eps)
    years_span = int(max(len(ni), len(rev), len(eps), 0))

    common_years = sorted(set(ni_years) & set(rev_years) & set(eps_years))
    if len(common_years) >= 2:
        period_start_year = int(common_years[0])
        period_end_year = int(common_years[-1])
    else:
        merged_years = sorted(set(ni_years) | set(rev_years) | set(eps_years))
        if len(merged_years) >= 2:
            period_start_year = int(merged_years[0])
            period_end_year = int(merged_years[-1])
        else:
            period_start_year = None
            period_end_year = None

    period_label = (
        f"{period_start_year}-{period_end_year}"
        if period_start_year is not None and period_end_year is not None
        else None
    )

    return {
        "ticker": symbol,
        "net_income": ni,
        "revenue": rev,
        "eps": eps,
        "cagr_net_income": cagr_net,
        "cagr_revenue": cagr_rev,
        "cagr_eps": cagr_eps,
        "cagr_years": years_span,
        "period_start_year": period_start_year,
        "period_end_year": period_end_year,
        "period_label": period_label,
        "period_source": "auto_annual_report",
        "input_mode": "auto",
    }


def _load_threshold_data() -> dict:
    """Return thresholds.json data using the shared module-level cache."""
    return _load_thresholds_cached()


def _save_threshold_data(payload: dict) -> None:
    THRESHOLDS_JSON_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    # Invalidate the shared thresholds cache so every subsequent read picks up the new values.
    _invalidate_thresholds_cache()


def _default_hybrid_mode_config(use_cagr: bool) -> dict:
    if use_cagr:
        return {
            "weights": [0.18, 0.06, 0.12, 0.20, 0.15, 0.15, 0.08, 0.12],
            "recommended": 0.52,
            "buy": 0.44,
            "risk": 0.34,
        }
    return {
        "weights": [0.20, 0.00, 0.10, 0.30, 0.20, 0.20, 0.00, 0.00],
        "recommended": 0.655,
        "buy": 0.555,
        "risk": 0.455,
    }


def _normalize_hybrid_mode_config(raw: dict, default: dict) -> dict:
    out = {
        "weights": list(default["weights"]),
        "recommended": float(default["recommended"]),
        "buy": float(default["buy"]),
        "risk": float(default["risk"]),
    }

    if not isinstance(raw, dict):
        return out

    weights_raw = raw.get("weights")
    if isinstance(weights_raw, list) and len(weights_raw) == 8:
        try:
            w = [float(x) for x in weights_raw]
            if all(np.isfinite(x) and x >= 0 for x in w) and sum(w) > 0:
                out["weights"] = w
        except (TypeError, ValueError):
            pass

    try:
        rec = float(raw.get("recommended"))
        buy = float(raw.get("buy"))
        risk = float(raw.get("risk"))
        if 0.0 <= risk <= buy <= rec <= 1.0:
            out["recommended"] = rec
            out["buy"] = buy
            out["risk"] = risk
    except (TypeError, ValueError):
        pass

    return out


def _get_hybrid_config_from_thresholds() -> dict:
    raw = _load_threshold_data()

    default_use = _default_hybrid_mode_config(True)
    default_no = _default_hybrid_mode_config(False)

    hybrid_weights = raw.get("hybrid_weights") if isinstance(raw.get("hybrid_weights"), dict) else {}
    hybrid_thresholds = raw.get("hybrid") if isinstance(raw.get("hybrid"), dict) else {}

    use_raw = {
        "weights": hybrid_weights.get("use_cagr"),
        "recommended": (hybrid_thresholds.get("use_cagr") or {}).get("recommended"),
        "buy": (hybrid_thresholds.get("use_cagr") or {}).get("buy"),
        "risk": (hybrid_thresholds.get("use_cagr") or {}).get("risk"),
    }
    no_raw = {
        "weights": hybrid_weights.get("no_cagr"),
        "recommended": (hybrid_thresholds.get("no_cagr") or {}).get("recommended"),
        "buy": (hybrid_thresholds.get("no_cagr") or {}).get("buy"),
        "risk": (hybrid_thresholds.get("no_cagr") or {}).get("risk"),
    }

    return {
        "use_cagr": _normalize_hybrid_mode_config(use_raw, default_use),
        "no_cagr": _normalize_hybrid_mode_config(no_raw, default_no),
    }


def _forward_label_from_price(
    ticker: str,
    *,
    horizon_days: int,
    target_return_pct: float,
    lookback_period: str,
    min_samples: int,
) -> dict | None:
    t = (ticker or "").strip()
    if not t:
        return None

    try:
        hist = yf.Ticker(t).history(period=lookback_period, interval="1d")
    except Exception:
        return None

    if hist is None or hist.empty or "Close" not in hist.columns:
        return None

    close = hist["Close"].astype(float).replace([np.inf, -np.inf], np.nan).dropna()
    if close.empty:
        return None

    fwd = (close.shift(-horizon_days) / close - 1.0) * 100.0
    fwd = fwd.replace([np.inf, -np.inf], np.nan).dropna()
    if len(fwd) < int(max(min_samples, 1)):
        return None

    lo, hi = np.percentile(fwd.values, [5, 95])
    fwd_w = fwd.clip(lower=lo, upper=hi)

    hit_rate = float((fwd_w >= target_return_pct).mean())
    median_ret = float(np.median(fwd_w.values))
    mean_ret = float(np.mean(fwd_w.values))

    label = 1 if hit_rate >= 0.5 else 0
    return {
        "label": label,
        "samples": int(len(fwd_w)),
        "hit_rate": hit_rate,
        "median_return_pct": median_ret,
        "mean_return_pct": mean_ret,
    }


def _metrics_for_threshold(scores: list[float], labels: list[int], threshold: float) -> dict:
    y = np.array(labels, dtype=int)
    s = np.array(scores, dtype=float)
    pred = (s >= threshold).astype(int)

    tp = int(((pred == 1) & (y == 1)).sum())
    tn = int(((pred == 0) & (y == 0)).sum())
    fp = int(((pred == 1) & (y == 0)).sum())
    fn = int(((pred == 0) & (y == 1)).sum())

    total = max(len(y), 1)
    accuracy = (tp + tn) / total
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = (2.0 * precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0

    tpr = recall
    tnr = tn / (tn + fp) if (tn + fp) > 0 else 0.0
    balanced_accuracy = 0.5 * (tpr + tnr)

    return {
        "threshold": float(threshold),
        "accuracy": float(accuracy),
        "balanced_accuracy": float(balanced_accuracy),
        "precision": float(precision),
        "recall": float(recall),
        "f1": float(f1),
        "confusion": {"tp": tp, "tn": tn, "fp": fp, "fn": fn},
    }


def _search_best_threshold(scores: list[float], labels: list[int]) -> dict:
    if not scores or not labels or len(scores) != len(labels):
        return {
            "best": None,
            "n": 0,
            "positive_ratio": 0.0,
            "note": "insufficient_samples",
        }

    y = np.array(labels, dtype=int)
    pos_ratio = float(y.mean()) if len(y) else 0.0

    grid = np.linspace(0.0, 1.0, 201)
    best = None
    best_key = None

    for thr in grid:
        m = _metrics_for_threshold(scores, labels, float(thr))
        # Prioritas: balanced_accuracy -> f1 -> accuracy
        key = (m["balanced_accuracy"], m["f1"], m["accuracy"])
        if best is None or key > best_key:
            best = m
            best_key = key

    return {
        "best": best,
        "n": int(len(scores)),
        "positive_ratio": pos_ratio,
        "note": "ok",
    }


def _extract_price_points(symbol: str, period: str = "10y") -> list[tuple[date, float]]:
    """Ambil deret harga adjusted close harian untuk perhitungan return."""

    s = (symbol or "").strip()
    if not s:
        return []

    try:
        hist = yf.Ticker(s).history(period=period, interval="1d", auto_adjust=False)
    except Exception:
        return []

    if hist is None or hist.empty:
        return []

    price_col = "Adj Close" if "Adj Close" in hist.columns else "Close"
    points: list[tuple[date, float]] = []
    for idx, row in hist.iterrows():
        raw = row.get(price_col)
        if raw is None:
            continue
        try:
            px = float(raw)
        except (TypeError, ValueError):
            continue
        if not np.isfinite(px) or px <= 0:
            continue
        points.append((idx.date(), px))

    points.sort(key=lambda x: x[0])
    return points


def _price_on_or_before(points: list[tuple[date, float]], target: date) -> float | None:
    for d, px in reversed(points):
        if d <= target:
            return px
    return None


def _price_on_or_after(points: list[tuple[date, float]], target: date, end_date: date) -> float | None:
    for d, px in points:
        if d >= target and d <= end_date:
            return px
    return None


def _subtract_years(d: date, years: int) -> date:
    y = d.year - years
    m = d.month
    day = d.day
    while day > 28:
        try:
            return date(y, m, day)
        except ValueError:
            day -= 1
    return date(y, m, day)


def _compute_return_pct(points: list[tuple[date, float]], start_date: date, end_date: date) -> float | None:
    if not points:
        return None
    if start_date > end_date:
        return None

    start_px = _price_on_or_after(points, start_date, end_date)
    end_px = _price_on_or_before(points, end_date)
    if start_px is None or end_px is None or start_px <= 0:
        return None
    return float((end_px / start_px - 1.0) * 100.0)


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


@app.get("/hybrid-config")
async def get_hybrid_config() -> dict:
    """Ambil konfigurasi bobot hybrid (use_cagr/no_cagr)."""

    return _get_hybrid_config_from_thresholds()


@app.post("/hybrid-config")
async def save_hybrid_config(payload: HybridConfigPayload) -> dict:
    """Simpan konfigurasi bobot hybrid (use_cagr/no_cagr)."""

    use_raw = payload.use_cagr.model_dump() if hasattr(payload.use_cagr, "model_dump") else payload.use_cagr.dict()
    no_raw = payload.no_cagr.model_dump() if hasattr(payload.no_cagr, "model_dump") else payload.no_cagr.dict()

    use_cfg = _normalize_hybrid_mode_config(use_raw, _default_hybrid_mode_config(True))
    no_cfg = _normalize_hybrid_mode_config(no_raw, _default_hybrid_mode_config(False))

    existing = _load_threshold_data()
    methods_cfg = existing.get("methods") if isinstance(existing.get("methods"), dict) else {}
    hybrid_cfg_existing = existing.get("hybrid") if isinstance(existing.get("hybrid"), dict) else {}
    meta_cfg = existing.get("meta") if isinstance(existing.get("meta"), dict) else {}

    hybrid_cfg_existing["use_cagr"] = {
        "recommended": use_cfg["recommended"],
        "buy": use_cfg["buy"],
        "risk": use_cfg["risk"],
    }
    hybrid_cfg_existing["no_cagr"] = {
        "recommended": no_cfg["recommended"],
        "buy": no_cfg["buy"],
        "risk": no_cfg["risk"],
    }

    out = {
        "methods": methods_cfg,
        "hybrid": hybrid_cfg_existing,
        "hybrid_weights": {
            "use_cagr": use_cfg["weights"],
            "no_cagr": no_cfg["weights"],
        },
        "meta": {
            **meta_cfg,
            "hybrid_config_updated_at": datetime.now(timezone.utc).isoformat(),
        },
    }
    _save_threshold_data(out)

    return {
        "saved": True,
        "use_cagr": use_cfg,
        "no_cagr": no_cfg,
    }


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


@app.post("/reset-all")
async def reset_all(payload: ResetPayload) -> dict:
    """Reset semua ticker tersimpan + data CAGR.

    Wajib confirmation exact: "yes, i want to reset"
    """

    expected = "yes, i want to reset"
    got = (payload.confirmation or "").strip().lower()
    if got != expected:
        raise HTTPException(status_code=400, detail="Confirmation mismatch")

    _reset_all_entries()
    return {"reset": True, "tickers": []}


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
            "period_start_year": None,
            "period_end_year": None,
            "period_label": f"Manual input ({years_span} points)",
            "period_source": "manual_annual_input",
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
            "period_start_year": None,
            "period_end_year": None,
            "period_label": f"Direct CAGR input ({cagr_years} years)",
            "period_source": "direct_cagr_input",
            "input_mode": "direct",
        }

    _save_cagr_data(existing)

    return evaluate_cagr_methods(results, use_cagr=True)


@app.post("/decision-cagr-auto")
async def decision_cagr_auto(request: CagrAutoRequest) -> dict:
    """Hitung CAGR otomatis dari annual report (yfinance financials/earnings_history)."""

    results: List[CagrResult] = []
    existing = _load_cagr_data()

    tickers = [item.ticker.strip() or "-" for item in request.items]
    fundamentals_df = get_stock_data(tickers) if tickers else None
    fundamentals = fundamentals_df.to_dict(orient="records") if fundamentals_df is not None else []

    auto_payload = {}
    missing = []

    for idx, item in enumerate(request.items):
        t = item.ticker.strip() or "-"
        auto_data = _extract_auto_cagr_payload(t)

        ni = auto_data.get("net_income") or []
        rev = auto_data.get("revenue") or []
        eps = auto_data.get("eps") or []
        if len(ni) < 2 or len(rev) < 2 or len(eps) < 2:
            missing.append(
                {
                    "ticker": t,
                    "reason": "Data annual report belum cukup (butuh minimal 2 titik untuk Net Income, Revenue, EPS)",
                }
            )
            continue

        cagr_net = float(auto_data.get("cagr_net_income") or 0.0)
        cagr_rev = float(auto_data.get("cagr_revenue") or 0.0)
        cagr_eps = float(auto_data.get("cagr_eps") or 0.0)
        cagr_years = int(auto_data.get("cagr_years") or 0)

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

        existing[t] = {
            "net_income": list(ni),
            "revenue": list(rev),
            "eps": list(eps),
            "cagr_net_income": cagr_net,
            "cagr_revenue": cagr_rev,
            "cagr_eps": cagr_eps,
            "cagr_years": cagr_years,
            "period_start_year": auto_data.get("period_start_year"),
            "period_end_year": auto_data.get("period_end_year"),
            "period_label": auto_data.get("period_label") or f"Auto annual report ({cagr_years} points)",
            "period_source": auto_data.get("period_source") or "auto_annual_report",
            "input_mode": "auto",
        }
        auto_payload[t] = {
            "net_income": list(ni),
            "revenue": list(rev),
            "eps": list(eps),
            "cagr_years": cagr_years,
            "period_start_year": auto_data.get("period_start_year"),
            "period_end_year": auto_data.get("period_end_year"),
            "period_label": auto_data.get("period_label"),
        }

    _save_cagr_data(existing)

    if not results:
        raise HTTPException(status_code=400, detail={"message": "Auto CAGR gagal: data annual report belum cukup", "missing": missing})

    out = evaluate_cagr_methods(results, use_cagr=True)
    out["annual"] = auto_payload
    out["missing"] = missing
    return out


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
    if years_val is None and input_mode in ("annual", "auto"):
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
        "period_start_year": data.get("period_start_year"),
        "period_end_year": data.get("period_end_year"),
        "period_label": data.get("period_label"),
        "period_source": data.get("period_source"),
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


@app.get("/performance-overview")
async def get_performance_overview(
    ticker: str = Query(..., description="Ticker saham, misal: BBCA.JK"),
    benchmark: str = Query("^JKSE", description="Benchmark index, default: ^JKSE"),
) -> dict:
    """Ringkasan return YTD/1Y/3Y/5Y untuk ticker vs benchmark."""

    t = (ticker or "").strip()
    bmk = (benchmark or "").strip() or "^JKSE"
    if not t:
        return {
            "ticker": "",
            "benchmark": bmk,
            "benchmark_name": "IDX COMPOSITE",
            "as_of": None,
            "returns": {},
        }

    ticker_points = _extract_price_points(t, period="10y")
    bench_points = _extract_price_points(bmk, period="10y")

    if not ticker_points:
        return {
            "ticker": t,
            "benchmark": bmk,
            "benchmark_name": "IDX COMPOSITE" if bmk.upper() == "^JKSE" else bmk,
            "as_of": None,
            "returns": {},
        }

    ticker_last = ticker_points[-1][0]
    bench_last = bench_points[-1][0] if bench_points else None
    as_of = min(ticker_last, bench_last) if bench_last else ticker_last

    ytd_start = date(as_of.year, 1, 1)
    one_year_start = _subtract_years(as_of, 1)
    three_year_start = _subtract_years(as_of, 3)
    five_year_start = _subtract_years(as_of, 5)

    returns = {
        "ytd": {
            "label": "YTD Return",
            "asset": _compute_return_pct(ticker_points, ytd_start, as_of),
            "benchmark": _compute_return_pct(bench_points, ytd_start, as_of) if bench_points else None,
        },
        "one_year": {
            "label": "1-Year Return",
            "asset": _compute_return_pct(ticker_points, one_year_start, as_of),
            "benchmark": _compute_return_pct(bench_points, one_year_start, as_of) if bench_points else None,
        },
        "three_year": {
            "label": "3-Year Return",
            "asset": _compute_return_pct(ticker_points, three_year_start, as_of),
            "benchmark": _compute_return_pct(bench_points, three_year_start, as_of) if bench_points else None,
        },
        "five_year": {
            "label": "5-Year Return",
            "asset": _compute_return_pct(ticker_points, five_year_start, as_of),
            "benchmark": _compute_return_pct(bench_points, five_year_start, as_of) if bench_points else None,
        },
    }

    return {
        "ticker": t,
        "benchmark": bmk,
        "benchmark_name": "IDX COMPOSITE" if bmk.upper() == "^JKSE" else bmk,
        "as_of": as_of.isoformat(),
        "returns": returns,
    }


@app.get("/ranking-data")
async def get_ranking_data() -> dict:
    """Kembalikan data ranking saham berdasarkan metode MCDM yang dipilih di frontend.

    - ranked: hanya ticker yang sudah punya input CAGR (annual/direct/auto)
    - unranked: ticker tersimpan yang belum punya data CAGR lengkap
    """

    saved_tickers = _load_saved_tickers()
    exclude_threshold = 0.15
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

        stored_mode = str(raw.get("input_mode") or "").strip().lower()
        if stored_mode == "direct" and has_direct:
            cagr_net = float(raw.get("cagr_net_income"))
            cagr_rev = float(raw.get("cagr_revenue"))
            cagr_eps = float(raw.get("cagr_eps"))
            input_mode = "direct"
            cagr_years = int(raw.get("cagr_years") or 0)
        elif stored_mode in ("annual", "auto") and has_annual:
            cagr_net = compute_cagr(raw.get("net_income") or [])
            cagr_rev = compute_cagr(raw.get("revenue") or [])
            cagr_eps = compute_cagr(raw.get("eps") or [])
            input_mode = stored_mode
            cagr_years = max(
                len(raw.get("net_income") or []),
                len(raw.get("revenue") or []),
                len(raw.get("eps") or []),
            )
            cagr_years = int(max(cagr_years, 0))
        elif has_direct:
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
            "sector": str(fund.get("Sector") or "Unknown"),
            "mos_pct": float(fund.get("MOS (%)") or 0.0),
            "div_yield_pct": float(fund.get("Dividend Yield (%)") or 0.0),
            "quality_score": fund.get("Quality Score"),
            "quality_label": str(fund.get("Quality Label") or "-"),
            "discount_score": fund.get("Discount Score"),
            "timing_verdict": str(fund.get("Discount Timing Verdict") or "-"),
            "cagr_all_zero": bool(abs(cagr_net) <= 1e-9 and abs(cagr_rev) <= 1e-9 and abs(cagr_eps) <= 1e-9),
        }

    if not results:
        return {
            "total_saved": len(saved_tickers),
            "ranked_count": 0,
            "unranked_count": len(unranked),
            "ranked": [],
            "unranked": unranked,
        }

    ranked = []
    method_keys = ["FUZZY_AHP_TOPSIS", "TOPSIS", "SAW", "AHP", "VIKOR"]
    for r in results:
        t = r.ticker
        meta = meta_by_ticker.get(t) or {}

        # Gunakan evaluasi per-ticker agar konsisten dengan detailed page
        # (single-ticker absolute scoring), bukan scoring relatif antar-alternatif.
        single_eval = evaluate_cagr_methods([r], use_cagr=True)
        methods = single_eval.get("methods", {})

        scores = {}
        for mk in method_keys:
            info = (methods.get(mk) or {}).get(t) or {}
            scores[mk] = {
                "score": info.get("score"),
                "decision": info.get("decision"),
                "category": info.get("category"),
            }

        hybrid_score = (scores.get("FUZZY_AHP_TOPSIS") or {}).get("score")
        hybrid_score_num = float(hybrid_score) if hybrid_score is not None else None
        if hybrid_score_num is not None and hybrid_score_num < exclude_threshold:
            unranked.append(
                {
                    "ticker": t,
                    "name": meta.get("name") or t,
                    "reason": f"Excluded from consideration (Hybrid score < {exclude_threshold:.2f})",
                }
            )
            continue

        cagr_years = int(meta.get("cagr_years") or 0)
        cagr_reliability = "high" if cagr_years >= 5 else ("medium" if cagr_years >= 3 else ("low" if cagr_years >= 2 else "insufficient"))

        ranked.append(
            {
                "ticker": t,
                "name": meta.get("name") or t,
                "input_mode": meta.get("input_mode") or "annual",
                "cagr_years": cagr_years,
                "cagr": meta.get("cagr") or {},
                "sector": meta.get("sector") or "Unknown",
                "mos_pct": meta.get("mos_pct"),
                "div_yield_pct": meta.get("div_yield_pct"),
                "quality_score": meta.get("quality_score"),
                "quality_label": meta.get("quality_label") or "-",
                "discount_score": meta.get("discount_score"),
                "timing_verdict": meta.get("timing_verdict") or "-",
                "cagr_reliability": cagr_reliability,
                "cagr_all_zero": bool(meta.get("cagr_all_zero")),
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


@app.post("/calibrate-thresholds")
async def calibrate_thresholds(payload: ThresholdCalibrationRequest) -> dict:
    """Cari threshold paling akurat berbasis forward-return backtest sederhana.

    Label aktual per ticker dihitung dari hit-rate forward return historis:
    label=1 jika >= 50% sampel window menghasilkan return >= target_return_pct.
    """

    saved_tickers = _load_saved_tickers()
    if not saved_tickers:
        raise HTTPException(status_code=400, detail="No saved tickers to calibrate")

    cagr_items = _load_cagr_data()
    fundamentals_df = get_stock_data(saved_tickers)
    fundamentals = fundamentals_df.to_dict(orient="records") if fundamentals_df is not None else []
    fund_by_ticker = {
        str(row.get("Ticker") or "").strip(): row
        for row in fundamentals
        if str(row.get("Ticker") or "").strip()
    }

    label_info = {}
    for t in saved_tickers:
        info = _forward_label_from_price(
            t,
            horizon_days=int(max(payload.horizon_days, 1)),
            target_return_pct=float(payload.target_return_pct),
            lookback_period=str(payload.lookback_period or "5y"),
            min_samples=int(max(payload.min_samples, 1)),
        )
        if info:
            label_info[t] = info

    if not label_info:
        raise HTTPException(status_code=400, detail="No tickers have sufficient history for calibration")

    # Dataset mode use_cagr=True (hanya ticker yang sudah ada CAGR)
    cagr_results: list[CagrResult] = []
    for t in saved_tickers:
        if t not in label_info:
            continue
        raw = cagr_items.get(t) if isinstance(cagr_items.get(t), dict) else {}
        has_direct = _has_direct_cagr(raw)
        has_annual = _has_annual_cagr(raw)
        if not has_direct and not has_annual:
            continue

        stored_mode = str(raw.get("input_mode") or "").strip().lower()
        if stored_mode == "direct" and has_direct:
            cagr_net = float(raw.get("cagr_net_income"))
            cagr_rev = float(raw.get("cagr_revenue"))
            cagr_eps = float(raw.get("cagr_eps"))
        else:
            cagr_net = compute_cagr(raw.get("net_income") or [])
            cagr_rev = compute_cagr(raw.get("revenue") or [])
            cagr_eps = compute_cagr(raw.get("eps") or [])

        fund = fund_by_ticker.get(t) or {}
        cagr_results.append(
            CagrResult(
                ticker=t,
                cagr_net_income=cagr_net,
                cagr_revenue=cagr_rev,
                cagr_eps=cagr_eps,
                roe=float(fund.get("ROE (%)") or 0.0),
                mos=float(fund.get("MOS (%)") or 0.0),
                pbv=float(fund.get("PBV") or 0.0),
                div_yield=float(fund.get("Dividend Yield (%)") or 0.0),
                per=float(fund.get("PER NOW") or 0.0),
                down_from_high=float(fund.get("Down From High 52 (%)") or 0.0),
            )
        )

    method_names = ["SAW", "AHP", "TOPSIS", "VIKOR", "FUZZY_AHP_TOPSIS"]
    calibrated = {}

    # Kalibrasi use_cagr=True
    for method in method_names:
        scores = []
        labels = []
        for r in cagr_results:
            out = evaluate_cagr_methods([r], use_cagr=True)
            info = ((out.get("methods") or {}).get(method) or {}).get(r.ticker) or {}
            sc = info.get("score")
            if sc is None:
                continue
            scores.append(float(sc))
            labels.append(int(label_info[r.ticker]["label"]))

        calibrated[method] = _search_best_threshold(scores, labels)

    # Kalibrasi hybrid dashboard (tanpa CAGR) untuk semua ticker berlabel
    no_cagr_scores = []
    no_cagr_labels = []
    for t in saved_tickers:
        if t not in label_info:
            continue
        fund = fund_by_ticker.get(t) or {}
        r = CagrResult(
            ticker=t,
            cagr_net_income=0.0,
            cagr_revenue=0.0,
            cagr_eps=0.0,
            roe=float(fund.get("ROE (%)") or 0.0),
            mos=float(fund.get("MOS (%)") or 0.0),
            pbv=float(fund.get("PBV") or 0.0),
            div_yield=float(fund.get("Dividend Yield (%)") or 0.0),
            per=float(fund.get("PER NOW") or 0.0),
            down_from_high=float(fund.get("Down From High 52 (%)") or 0.0),
        )
        out = evaluate_cagr_methods([r], use_cagr=False)
        info = ((out.get("methods") or {}).get("FUZZY_AHP_TOPSIS") or {}).get(t) or {}
        sc = info.get("score")
        if sc is None:
            continue
        no_cagr_scores.append(float(sc))
        no_cagr_labels.append(int(label_info[t]["label"]))

    calibrated["FUZZY_AHP_TOPSIS_NO_CAGR"] = _search_best_threshold(no_cagr_scores, no_cagr_labels)

    saved_thresholds = None
    if payload.save:
        existing = _load_threshold_data()
        methods_cfg = existing.get("methods") if isinstance(existing.get("methods"), dict) else {}

        for method in ["SAW", "AHP", "TOPSIS", "VIKOR"]:
            best = (calibrated.get(method) or {}).get("best") or {}
            thr = best.get("threshold")
            if thr is None:
                continue
            thr_f = float(thr)
            methods_cfg[method] = {
                "buy": thr_f,
                "mos_boost_buy": max(0.0, min(1.0, thr_f - 0.08)),
                "mos_trigger": 15.0,
            }

        hybrid_cfg = existing.get("hybrid") if isinstance(existing.get("hybrid"), dict) else {}

        best_use_cagr = (calibrated.get("FUZZY_AHP_TOPSIS") or {}).get("best") or {}
        thr_use_cagr = best_use_cagr.get("threshold")
        if thr_use_cagr is not None:
            thr = float(thr_use_cagr)
            hybrid_cfg["use_cagr"] = {
                "recommended": max(0.0, min(1.0, thr + 0.10)),
                "buy": thr,
                "risk": max(0.0, min(1.0, thr - 0.12)),
            }

        best_no_cagr = (calibrated.get("FUZZY_AHP_TOPSIS_NO_CAGR") or {}).get("best") or {}
        thr_no_cagr = best_no_cagr.get("threshold")
        if thr_no_cagr is not None:
            thr = float(thr_no_cagr)
            hybrid_cfg["no_cagr"] = {
                "recommended": max(0.0, min(1.0, thr + 0.10)),
                "buy": thr,
                "risk": max(0.0, min(1.0, thr - 0.10)),
            }

        out = {
            "methods": methods_cfg,
            "hybrid": hybrid_cfg,
            "hybrid_weights": existing.get("hybrid_weights") if isinstance(existing.get("hybrid_weights"), dict) else {},
            "meta": {
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "horizon_days": int(payload.horizon_days),
                "target_return_pct": float(payload.target_return_pct),
                "lookback_period": str(payload.lookback_period),
                "min_samples": int(payload.min_samples),
            },
        }
        _save_threshold_data(out)
        saved_thresholds = out

    return {
        "calibration_input": {
            "saved_tickers": len(saved_tickers),
            "labeled_tickers": len(label_info),
            "cagr_tickers": len(cagr_results),
            "horizon_days": int(payload.horizon_days),
            "target_return_pct": float(payload.target_return_pct),
            "lookback_period": str(payload.lookback_period),
            "min_samples": int(payload.min_samples),
        },
        "labels": label_info,
        "calibrated": calibrated,
        "saved": bool(payload.save),
        "thresholds": saved_thresholds,
    }


# ──────────────────────────────────────────────────────────────
# Risk Management with Anti-Panic Mechanism
# ──────────────────────────────────────────────────────────────

class RiskAllocationRequest(BaseModel):
    profile: str  # "ultra_conservative", "conservative", "conservative_semibalance", "balanced", "dividend_chaser", "aggressive", "custom"
    total_capital: float  # total modal dalam Rp
    tickers: List[str]  # daftar ticker dari dashboard
    # Custom profile fields (hanya dipakai jika profile == "custom")
    custom_bluechip_pct: float = 0
    custom_dividend_pct: float = 0
    custom_experimental_pct: float = 0
    custom_cash_reserve_pct: float = 10
    custom_max_single_exposure_pct: float = 25
    preferred_tickers: List[str] = []
    blacklisted_tickers: List[str] = []


_RISK_PROFILES = {
    "ultra_conservative": {
        "label": "Ultra Conservative",
        "bluechip_pct": 70,
        "dividend_pct": 30,
        "experimental_pct": 0,
        "cash_reserve_pct": 20,
        "max_single_exposure_pct": 15,
        "description": "Zero eksperimental. Hanya bluechip + dividend. Cash reserve besar untuk tidur nyenyak.",
    },
    "conservative": {
        "label": "Conservative",
        "bluechip_pct": 60,
        "dividend_pct": 30,
        "experimental_pct": 10,
        "cash_reserve_pct": 15,
        "max_single_exposure_pct": 20,
        "description": "Prioritas stabilitas. Sebagian besar modal di bluechip, cash reserve tinggi untuk jaga-jaga.",
    },
    "conservative_semibalance": {
        "label": "Conservative-Semibalance",
        "bluechip_pct": 35,
        "dividend_pct": 50,
        "experimental_pct": 15,
        "cash_reserve_pct": 12,
        "max_single_exposure_pct": 20,
        "description": "Fokus dividend income, ditopang bluechip. Cocok untuk passive income seeker.",
    },
    "balanced": {
        "label": "Balanced",
        "bluechip_pct": 40,
        "dividend_pct": 35,
        "experimental_pct": 25,
        "cash_reserve_pct": 10,
        "max_single_exposure_pct": 25,
        "description": "Seimbang antara pertumbuhan dan keamanan. Cash reserve cukup untuk 1-2x average down.",
    },
    "dividend_chaser": {
        "label": "Dividend Chaser",
        "bluechip_pct": 30,
        "dividend_pct": 70,
        "experimental_pct": 0,
        "cash_reserve_pct": 10,
        "max_single_exposure_pct": 25,
        "description": "Fokus maksimal di saham dividen tinggi. 70% modal untuk dividend, 30% bluechip sebagai anchor.",
    },
    "aggressive": {
        "label": "Aggressive",
        "bluechip_pct": 20,
        "dividend_pct": 30,
        "experimental_pct": 50,
        "cash_reserve_pct": 5,
        "max_single_exposure_pct": 30,
        "description": "High risk high reward. Eksperimental dominan, cash reserve minimal.",
    },
}


def _classify_ticker_bucket(stock: dict) -> str:
    """Klasifikasi otomatis ticker ke salah satu bucket.

    Urutan prioritas:
    1. Bluechip: Quality >= 0.65 AND Market Cap >= 50 Triliun
    2. Dividend Chaser: Div Yield >= 4% AND Quality >= 0.5
    3. Experimental: sisanya
    """

    quality = float(stock.get("Quality Score") or 0.0)
    market_cap = float(stock.get("Market Cap") or 0.0)
    div_yield_raw = stock.get("Dividend Yield (%)")

    # Normalize div_yield
    dy = 0.0
    if div_yield_raw is not None:
        try:
            dy = float(div_yield_raw)
        except (TypeError, ValueError):
            dy = 0.0
    if 0 < dy < 1:
        dy = dy * 100

    # Bluechip: high quality + large cap
    if quality >= 0.65 and market_cap >= 50_000_000_000_000:
        return "bluechip"

    # Dividend Chaser: good yield + decent quality
    if dy >= 4.0 and quality >= 0.5:
        return "dividend"

    return "experimental"


@app.post("/risk-allocation")
async def risk_allocation(payload: RiskAllocationRequest) -> dict:
    """Hitung alokasi portofolio berdasarkan risk profile.

    Auto-klasifikasi ticker ke 3 bucket (bluechip/dividend/experimental),
    lalu alokasikan modal sesuai profil dengan anti-panic buffer.
    """

    profile_key = (payload.profile or "balanced").strip().lower()

    if profile_key == "custom":
        # Validasi custom percentages
        bp = float(payload.custom_bluechip_pct or 0)
        dp = float(payload.custom_dividend_pct or 0)
        ep = float(payload.custom_experimental_pct or 0)
        cr = float(payload.custom_cash_reserve_pct or 10)
        ms = float(payload.custom_max_single_exposure_pct or 25)

        bucket_sum = bp + dp + ep
        if abs(bucket_sum - 100.0) > 0.01:
            raise HTTPException(status_code=400, detail=f"Bluechip + Dividend + Experimental harus = 100%. Sekarang: {bucket_sum}%")
        if cr < 0 or cr > 50:
            raise HTTPException(status_code=400, detail=f"Cash reserve harus 0-50%. Sekarang: {cr}%")

        profile = {
            "label": "Custom",
            "bluechip_pct": bp,
            "dividend_pct": dp,
            "experimental_pct": ep,
            "cash_reserve_pct": cr,
            "max_single_exposure_pct": ms,
            "description": f"Custom: Bluechip {bp:.0f}% / Dividend {dp:.0f}% / Experimental {ep:.0f}% — Cash reserve {cr:.0f}%",
        }
    elif profile_key not in _RISK_PROFILES:
        valid = ", ".join(list(_RISK_PROFILES.keys()) + ["custom"])
        raise HTTPException(status_code=400, detail=f"Profile tidak valid: {profile_key}. Pilih: {valid}")
    else:
        profile = _RISK_PROFILES[profile_key]
    total_capital = float(payload.total_capital or 0)
    if total_capital <= 0:
        raise HTTPException(status_code=400, detail="Total capital harus > 0")

    tickers = [t.strip() for t in (payload.tickers or []) if t.strip()]
    if not tickers:
        raise HTTPException(status_code=400, detail="Minimal 1 ticker diperlukan")

    # Ambil data fundamental untuk semua ticker
    df = get_stock_data(tickers)
    stock_data = df.to_dict(orient="records") if df is not None else []

    # Filter tickers
    blacklisted_set = {t.upper().strip() for t in (payload.blacklisted_tickers or []) if t.strip()}
    preferred_set = {t.upper().strip() for t in (payload.preferred_tickers or []) if t.strip()}

    # Klasifikasi tiap ticker
    ticker_buckets: dict = {}  # ticker -> { bucket, stock_data }
    for s in stock_data:
        t_raw = str(s.get("Ticker") or s.get("Name") or "-")
        t = t_raw.upper().strip()
        
        if t in blacklisted_set:
            continue
            
        bucket = _classify_ticker_bucket(s)
        ticker_buckets[t_raw] = {
            "bucket": bucket,
            "is_preferred": (t in preferred_set),
            "price": float(s.get("Price") or 0),
            "name": str(s.get("Name") or t_raw),
            "sector": str(s.get("Sector") or "-"),
            "quality_score": float(s.get("Quality Score") or 0),
            "quality_label": str(s.get("Quality Label") or "-"),
            "div_yield": float(s.get("Dividend Yield (%)") or 0),
            "market_cap": float(s.get("Market Cap") or 0),
            "hybrid_score": float(s.get("Final Hybrid Score") or s.get("Hybrid Score") or 0),
            "decision": str(s.get("Final Decision Buy") or s.get("Decision Buy") or "NO BUY"),
        }

    # Hitung capital per bucket
    cash_reserve_pct = profile["cash_reserve_pct"]
    investable_capital = total_capital * (1 - cash_reserve_pct / 100.0)
    cash_reserve = total_capital - investable_capital
    max_single_pct = profile["max_single_exposure_pct"]
    max_single_capital = total_capital * (max_single_pct / 100.0)

    bucket_names = ["bluechip", "dividend", "experimental"]
    bucket_pcts = {
        "bluechip": profile["bluechip_pct"],
        "dividend": profile["dividend_pct"],
        "experimental": profile["experimental_pct"],
    }

    # Group tickers by bucket
    grouped: dict = {b: [] for b in bucket_names}
    for t, info in ticker_buckets.items():
        grouped[info["bucket"]].append(t)

    # Hitung capital per bucket
    bucket_capitals: dict = {}
    for b in bucket_names:
        bucket_capitals[b] = investable_capital * (bucket_pcts[b] / 100.0)

    # Alokasi per-ticker
    allocations = []
    bucket_summaries = {}

    for b in bucket_names:
        tickers_in_bucket = grouped[b]
        capital_for_bucket = bucket_capitals[b]

        if not tickers_in_bucket:
            bucket_summaries[b] = {
                "pct": bucket_pcts[b],
                "capital": round(capital_for_bucket, 0),
                "ticker_count": 0,
                "tickers": [],
                "unallocated": round(capital_for_bucket, 0),
            }
            continue

        # ── Sortir berdasarkan Hybrid Score (tertinggi = paling worth it) ──
        # DAN prioritas Preferred Stocks
        tickers_in_bucket.sort(
            key=lambda t: (ticker_buckets[t]["is_preferred"], ticker_buckets[t]["hybrid_score"]),
            reverse=True,
        )

        # ── Strategi alokasi berbeda per bucket ──
        use_greedy_base = (b == "bluechip")
        use_hybrid_base = (b == "dividend")

        remaining_capital = capital_for_bucket
        capital_per_ticker = capital_for_bucket / len(tickers_in_bucket)
        
        bucket_allocated = 0.0
        bucket_ticker_list = []

        for rank, t in enumerate(tickers_in_bucket, start=1):
            info = ticker_buckets[t]
            price = info["price"]
            is_pref = info["is_preferred"]
            
            use_greedy = use_greedy_base or is_pref

            if price <= 0:
                bucket_ticker_list.append(t)
                allocations.append({
                    "ticker": t,
                    "name": info["name"],
                    "bucket": b,
                    "rank": rank,
                    "hybrid_score": round(info["hybrid_score"], 3),
                    "capital_allocated": 0,
                    "price": 0,
                    "lots": 0,
                    "shares": 0,
                    "pct_of_total": 0,
                    "note": "Harga tidak tersedia" + (" (Preferred)" if is_pref else ""),
                })
                continue

            if use_greedy and remaining_capital <= 0:
                bucket_ticker_list.append(t)
                allocations.append({
                    "ticker": t,
                    "name": info["name"],
                    "bucket": b,
                    "rank": rank,
                    "hybrid_score": round(info["hybrid_score"], 3),
                    "capital_allocated": 0,
                    "price": round(price, 0),
                    "lots": 0,
                    "shares": 0,
                    "pct_of_total": 0,
                    "note": "Modal bucket sudah habis (rank lebih rendah)" + (" (Preferred)" if is_pref else ""),
                })
                continue

            # Hitung Effective Capital target
            if use_greedy:
                effective_capital = min(remaining_capital, max_single_capital)
            elif use_hybrid_base:
                greedy_cap = min(remaining_capital, max_single_capital)
                effective_capital = min((capital_per_ticker + greedy_cap) / 2, max_single_capital)
            else:
                effective_capital = min(capital_per_ticker, remaining_capital, max_single_capital)

            # Hitung lot (1 lot = 100 lembar di IDX)
            shares_float = effective_capital / price
            lots = int(shares_float // 100)

            if lots < 1:
                bucket_ticker_list.append(t)
                allocations.append({
                    "ticker": t,
                    "name": info["name"],
                    "bucket": b,
                    "rank": rank,
                    "hybrid_score": round(info["hybrid_score"], 3),
                    "capital_allocated": 0,
                    "price": round(price, 0),
                    "lots": 0,
                    "shares": 0,
                    "pct_of_total": 0,
                    "note": f"Modal tidak cukup untuk 1 lot (butuh Rp {price * 100:,.0f})",
                })
                continue

            shares = lots * 100
            actual_cost = shares * price
            pct_of_total = (actual_cost / total_capital) * 100

            remaining_capital -= actual_cost
            bucket_allocated += actual_cost
            bucket_ticker_list.append(t)

            allocations.append({
                "ticker": t,
                "name": info["name"],
                "bucket": b,
                "rank": rank,
                "hybrid_score": round(info["hybrid_score"], 3),
                "capital_allocated": round(actual_cost, 0),
                "price": round(price, 0),
                "lots": lots,
                "shares": shares,
                "pct_of_total": round(pct_of_total, 2),
                "note": "Preferred Priority" if is_pref else None,
            })

        bucket_summaries[b] = {
            "pct": bucket_pcts[b],
            "capital": round(capital_for_bucket, 0),
            "ticker_count": len(tickers_in_bucket),
            "tickers": bucket_ticker_list,
            "allocated": round(bucket_allocated, 0),
            "unallocated": round(capital_for_bucket - bucket_allocated, 0),
        }

    # ── Sweep Round: habiskan sisa investable capital ──
    # Setelah alokasi per-bucket, sisa modal (karena lot rounding) disapu
    # dengan beli 1 lot tambahan di ticker yang masih muat, berdasarkan
    # Hybrid Score. Ini memastikan ~100% capital utilization.
    total_invested_initial = sum(a["capital_allocated"] for a in allocations)
    sweep_remaining = investable_capital - total_invested_initial

    # Buat lookup cepat: ticker → index di allocations
    alloc_index: dict = {}
    for i, a in enumerate(allocations):
        alloc_index[a["ticker"]] = i

    # Semua ticker yang bisa dibeli, sortir by hybrid score
    all_tickers_sorted = sorted(
        ticker_buckets.keys(),
        key=lambda t: ticker_buckets[t]["hybrid_score"],
        reverse=True,
    )

    sweep_count = 0
    sweep_pass = 0
    max_sweep_passes = 50  # safety limit

    while sweep_remaining > 0 and sweep_pass < max_sweep_passes:
        bought_this_pass = False
        sweep_pass += 1

        for t in all_tickers_sorted:
            info = ticker_buckets[t]
            price = info["price"]
            if price <= 0:
                continue

            # Skip bucket yang alokasi-nya 0% di profile
            t_bucket = info["bucket"]
            if bucket_pcts.get(t_bucket, 0) <= 0:
                continue

            one_lot_cost = price * 100
            if one_lot_cost > sweep_remaining:
                continue

            # Cek max single exposure
            idx = alloc_index.get(t)
            current_invested = allocations[idx]["capital_allocated"] if idx is not None else 0
            if current_invested + one_lot_cost > max_single_capital:
                continue

            # Beli 1 lot tambahan
            if idx is not None:
                allocations[idx]["lots"] += 1
                allocations[idx]["shares"] += 100
                allocations[idx]["capital_allocated"] = round(allocations[idx]["capital_allocated"] + one_lot_cost, 0)
                allocations[idx]["pct_of_total"] = round((allocations[idx]["capital_allocated"] / total_capital) * 100, 2)
                if allocations[idx]["note"] is None:
                    allocations[idx]["note"] = "+1 lot (sweep)"
                elif "sweep" in str(allocations[idx]["note"]):
                    # Update sweep count in note
                    sweep_count += 1
                else:
                    allocations[idx]["note"] = str(allocations[idx]["note"]) + " +1 lot (sweep)"

            sweep_remaining -= one_lot_cost
            bought_this_pass = True
            break  # restart loop to re-check best option

        if not bought_this_pass:
            break

    # Update bucket summaries after sweep
    for b in bucket_names:
        bucket_tickers = [a for a in allocations if a["bucket"] == b]
        total_b = sum(a["capital_allocated"] for a in bucket_tickers)
        if b in bucket_summaries:
            bucket_summaries[b]["allocated"] = round(total_b, 0)
            bucket_summaries[b]["unallocated"] = round(bucket_summaries[b]["capital"] - total_b, 0)

    # Total yang benar-benar diam di saham
    total_invested = sum(a["capital_allocated"] for a in allocations)
    total_remaining = total_capital - total_invested

    # Anti-panic message
    if profile_key == "conservative":
        panic_msg = (
            f"Sisihkan Rp {cash_reserve:,.0f} sebagai buffer emergency. "
            f"Jangan gunakan uang ini untuk beli saham saat market turun. "
            f"Portofolio bluechip-heavy mu akan stabil sendiri."
        )
    elif profile_key == "balanced":
        panic_msg = (
            f"Simpan Rp {cash_reserve:,.0f} sebagai amunisi average down. "
            f"Saat market turun 10%+, baru gunakan cash ini untuk top up posisi dividend/bluechip."
        )
    else:
        panic_msg = (
            f"Cash Rp {cash_reserve:,.0f} minimal, pastikan kamu siap mental lihat portofolio merah. "
            f"Kalau panik, jangan jual — justru average down posisi experimental yang punya fundamental kuat."
        )

    return {
        "profile": profile_key,
        "profile_label": profile["label"],
        "profile_description": profile["description"],
        "total_capital": round(total_capital, 0),
        "cash_reserve_pct": cash_reserve_pct,
        "cash_reserve": round(cash_reserve, 0),
        "investable_capital": round(investable_capital, 0),
        "total_invested": round(total_invested, 0),
        "total_remaining": round(total_remaining, 0),
        "max_single_exposure_pct": max_single_pct,
        "buckets": bucket_summaries,
        "allocations": allocations,
        "ticker_classification": {
            t: {"bucket": info["bucket"], "quality_score": info["quality_score"],
                "div_yield": info["div_yield"], "market_cap": info["market_cap"]}
            for t, info in ticker_buckets.items()
        },
        "anti_panic": {
            "cash_reserve": round(cash_reserve, 0),
            "max_single_exposure_pct": max_single_pct,
            "message": panic_msg,
        },
    }

