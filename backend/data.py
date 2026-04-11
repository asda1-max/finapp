import yfinance as yf
import pandas as pd
import numpy as np
from pathlib import Path
import json
import os
from backend.decision_making import CagrResult, evaluate_cagr_methods, compute_cagr

FINAPP_DATA_DIR = os.environ.get('FINAPP_DATA_DIR')
if FINAPP_DATA_DIR:
    CAGR_JSON_PATH = Path(FINAPP_DATA_DIR) / 'cagr_data.json'
else:
    CAGR_JSON_PATH = Path(__file__).with_name("cagr_data.json")


def _normalize_percent_value(raw_value):
    """Normalisasi nilai rasio yfinance ke persen.

    Banyak field yfinance berbentuk rasio (mis. 0.35 = 35%).
    Untuk kasus payout > 100%, nilai bisa menjadi 1.17 (=117%).
    Jadi rentang kecil sekitar -3..3 diperlakukan sebagai rasio dan dikali 100.
    """

    if raw_value is None:
        return None
    try:
        val = float(raw_value)
    except (TypeError, ValueError):
        return None

    if not np.isfinite(val):
        return None

    if val != 0 and abs(val) <= 3:
        return val * 100.0
    return val


def _normalize_debt_to_equity_value(raw_value):
    """Normalisasi Debt to Equity agar konsisten dalam persen.

        Catatan bugfix:
        - Nilai seperti 3.69 dari provider sering sudah berarti 3.69%.
            Jadi JANGAN diubah jadi 369.

        Aturan:
        - Jika nilai benar-benar fraksional (<= 1), anggap rasio dan ubah ke persen.
            Contoh: 0.8 -> 80.
        - Di atas itu, biarkan apa adanya (sudah persen).
    """

    if raw_value is None:
        return None
    try:
        val = float(raw_value)
    except (TypeError, ValueError):
        return None

    if not np.isfinite(val):
        return None

    if val != 0 and abs(val) <= 1:
        return val * 100.0
    return val


def _estimate_debt_to_equity_from_balance_sheet(stock):
    """Fallback estimasi D/E (%) dari balance sheet jika info.debtToEquity kosong."""

    try:
        bs = stock.balance_sheet
    except Exception:
        return None

    if bs is None:
        return None
    try:
        if bs.empty:
            return None
    except Exception:
        return None

    def _get_latest_row_value(candidates):
        for name in candidates:
            if name not in bs.index:
                continue
            try:
                row = pd.to_numeric(bs.loc[name], errors="coerce").replace([np.inf, -np.inf], np.nan).dropna()
                if row.empty:
                    continue
                return float(row.iloc[0])
            except Exception:
                continue
        return None

    debt_val = _get_latest_row_value([
        "Total Debt",
        "TotalDebt",
        "Long Term Debt",
        "LongTermDebt",
        "Total Liabilities Net Minority Interest",
        "Total Liabilities",
    ])

    equity_val = _get_latest_row_value([
        "Stockholders Equity",
        "Total Stockholder Equity",
        "Total Equity Gross Minority Interest",
        "Total Equity",
        "Common Stock Equity",
    ])

    if debt_val is None or equity_val is None:
        return None
    if not np.isfinite(debt_val) or not np.isfinite(equity_val):
        return None
    if equity_val <= 0:
        return None

    return float((debt_val / equity_val) * 100.0)


def _compute_quality_profile(*, info: dict, roe_pct: float, market_cap: float) -> dict:
    """Hitung quality score saham (0..1) dari faktor fundamental utama."""

    sector = str(info.get("sector") or "").strip().lower()
    industry = str(info.get("industry") or "").strip().lower()
    is_bank = ("bank" in sector) or ("bank" in industry) or ("banks" in industry)

    npm_pct = _normalize_percent_value(info.get("profitMargins"))
    de_pct = _normalize_debt_to_equity_value(info.get("debtToEquity"))

    current_ratio_raw = info.get("currentRatio")
    try:
        current_ratio = float(current_ratio_raw) if current_ratio_raw is not None else None
    except (TypeError, ValueError):
        current_ratio = None
    if current_ratio is not None and not np.isfinite(current_ratio):
        current_ratio = None

    # ROE score
    if roe_pct >= 20:
        roe_score = 1.0
    elif roe_pct >= 15:
        roe_score = 0.8
    elif roe_pct >= 10:
        roe_score = 0.6
    elif roe_pct >= 5:
        roe_score = 0.4
    else:
        roe_score = 0.2

    # Net Profit Margin score
    if npm_pct is None:
        npm_score = 0.5
    elif npm_pct >= 25:
        npm_score = 1.0
    elif npm_pct >= 15:
        npm_score = 0.8
    elif npm_pct >= 8:
        npm_score = 0.6
    elif npm_pct >= 3:
        npm_score = 0.45
    elif npm_pct >= 0:
        npm_score = 0.35
    else:
        npm_score = 0.1

    # Debt to Equity score
    if de_pct is None:
        de_score = 0.6 if is_bank else 0.5
    elif is_bank:
        if de_pct <= 800:
            de_score = 0.7
        elif de_pct <= 1200:
            de_score = 0.55
        else:
            de_score = 0.35
    else:
        if de_pct <= 50:
            de_score = 1.0
        elif de_pct <= 100:
            de_score = 0.8
        elif de_pct <= 150:
            de_score = 0.6
        elif de_pct <= 250:
            de_score = 0.4
        else:
            de_score = 0.2

    # Current ratio score
    if current_ratio is None:
        current_score = 0.6 if is_bank else 0.5
    elif current_ratio >= 2.0:
        current_score = 1.0
    elif current_ratio >= 1.5:
        current_score = 0.8
    elif current_ratio >= 1.2:
        current_score = 0.6
    elif current_ratio >= 1.0:
        current_score = 0.45
    else:
        current_score = 0.2

    # Market cap tier score (proxy quality/stability)
    mc = float(market_cap or 0.0)
    if mc >= 100_000_000_000_000:
        mc_score = 1.0
    elif mc >= 50_000_000_000_000:
        mc_score = 0.85
    elif mc >= 10_000_000_000_000:
        mc_score = 0.65
    elif mc >= 2_000_000_000_000:
        mc_score = 0.45
    else:
        mc_score = 0.25

    # Bobot kualitas
    quality_score = (
        (0.25 * roe_score)
        + (0.25 * npm_score)
        + (0.20 * de_score)
        + (0.15 * current_score)
        + (0.15 * mc_score)
    )

    if quality_score >= 0.8:
        quality_label = "Premium"
    elif quality_score >= 0.65:
        quality_label = "Solid"
    elif quality_score >= 0.5:
        quality_label = "Standard"
    else:
        quality_label = "Weak"

    return {
        "score": float(max(0.0, min(quality_score, 1.0))),
        "label": quality_label,
        "npm_pct": npm_pct,
        "debt_to_equity_pct": de_pct,
        "current_ratio": current_ratio,
        "is_bank": is_bank,
    }


def _apply_quality_verdict(df: pd.DataFrame) -> pd.DataFrame:
    """Tambahkan verdict kualitas yang bisa dipakai sebagai sinyal tambahan."""

    if df is None or len(df) == 0:
        return df

    verdicts = []
    for _, row in df.iterrows():
        q = pd.to_numeric(row.get("Quality Score"), errors="coerce")
        q = float(q) if not pd.isna(q) else 0.0
        mos = float(pd.to_numeric(row.get("MOS (%)"), errors="coerce") or 0.0)
        final_dec = str(row.get("Final Decision Buy") or row.get("Decision Buy") or "NO BUY").strip().upper()

        if q >= 0.8:
            if mos < 0:
                verdict = "Quality Premium with Expensive Prices"
            elif final_dec == "BUY":
                verdict = "Quality Premium"
            else:
                verdict = "Quality Premium (Watchlist)"
        elif q >= 0.65:
            verdict = "Quality Solid"
        elif q >= 0.5:
            verdict = "Quality Standard"
        else:
            verdict = "Quality Weak"

        verdicts.append(verdict)

    df["Quality Verdict"] = verdicts
    return df


def _apply_discount_timing_verdict(df: pd.DataFrame) -> pd.DataFrame:
    """Tambahkan verdict timing berbasis Hybrid + Discount + Quality.

    Prinsip:
    - Discount score tidak berdiri sendiri.
    - Wajib dibaca bersama sinyal hybrid dan quality score.
    - "Buy with Risk" bisa di-upgrade jika diskon tinggi + quality OK.
    """

    if df is None or len(df) == 0:
        return df

    verdicts = []
    for _, row in df.iterrows():
        final_dec = str(row.get("Final Decision Buy") or row.get("Decision Buy") or "NO BUY").strip().upper()
        execution_dec = str(row.get("Execution Decision") or final_dec).strip().upper()
        hybrid_cat = str(row.get("Final Hybrid Category") or row.get("Hybrid Category") or "").strip()
        dscore = pd.to_numeric(row.get("Discount Score"), errors="coerce")
        qscore = pd.to_numeric(row.get("Quality Score"), errors="coerce")

        dscore = float(dscore) if not pd.isna(dscore) else 0.0
        qscore = float(qscore) if not pd.isna(qscore) else 0.0

        if final_dec != "BUY":
            # Cek apakah "Buy with Risk" bisa di-upgrade oleh discount + quality
            if hybrid_cat == "Buy with Risk" and dscore >= 0.50 and qscore >= 0.5:
                verdict = "BUY signal marginal, tapi timing diskon bagus (consider buy)"
            else:
                verdict = "NO BUY - ikut hybrid signal"
        elif execution_dec == "HOLD":
            verdict = "BUY signal ada, tapi HOLD oleh safety check"
        elif qscore < 0.5 and dscore >= 0.35:
            verdict = "Discount tinggi, tapi quality lemah (hindari value trap)"
        elif dscore >= 0.50:
            verdict = "BUY - timing sangat bagus (diskon tinggi)"
        elif dscore >= 0.35:
            verdict = "BUY - timing bagus"
        else:
            verdict = "BUY - tapi tunggu koreksi lebih dalam"

        verdicts.append(verdict)

    df["Discount Timing Verdict"] = verdicts
    return df


def _load_cagr_items() -> dict:
    if not CAGR_JSON_PATH.exists():
        return {}
    try:
        raw = json.loads(CAGR_JSON_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}

    items = raw.get("items") if isinstance(raw, dict) else {}
    if not isinstance(items, dict):
        return {}

    # Normalisasi key ke lowercase agar cocok dengan ticker dashboard.
    out = {}
    for k, v in items.items():
        key = str(k or "").strip().lower()
        if key:
            out[key] = v if isinstance(v, dict) else {}
    return out


def _extract_cagr_for_ticker(ticker: str, cagr_items: dict) -> tuple[float, float, float, bool]:
    t = str(ticker or "").strip().lower()
    raw = cagr_items.get(t) if isinstance(cagr_items.get(t), dict) else {}

    def _num(v):
        try:
            x = float(v)
            return x if np.isfinite(x) else None
        except (TypeError, ValueError):
            return None

    direct_net = _num(raw.get("cagr_net_income"))
    direct_rev = _num(raw.get("cagr_revenue"))
    direct_eps = _num(raw.get("cagr_eps"))
    has_direct = direct_net is not None and direct_rev is not None and direct_eps is not None
    if has_direct:
        return float(direct_net), float(direct_rev), float(direct_eps), True

    ni = raw.get("net_income") if isinstance(raw.get("net_income"), list) else []
    rev = raw.get("revenue") if isinstance(raw.get("revenue"), list) else []
    eps = raw.get("eps") if isinstance(raw.get("eps"), list) else []
    has_annual = len(ni) >= 2 and len(rev) >= 2 and len(eps) >= 2
    if has_annual:
        return compute_cagr(ni), compute_cagr(rev), compute_cagr(eps), True

    return 0.0, 0.0, 0.0, False


def _extract_financial_series(financials, candidates: list[str]) -> list[float]:
    if financials is None:
        return []
    try:
        idx = list(financials.index)
    except Exception:
        return []

    for name in candidates:
        if name not in idx:
            continue
        try:
            row = financials.loc[name]
            row = row.sort_index().dropna()
            vals = pd.to_numeric(row, errors="coerce").replace([np.inf, -np.inf], np.nan).dropna().tolist()
            vals = [float(v) for v in vals if v is not None]
            if len(vals) >= 2:
                return vals
        except Exception:
            continue
    return []


def _extract_eps_series_for_auto_cagr(stock, financials) -> list[float]:
    eps_from_fin = _extract_financial_series(financials, ["Diluted EPS", "Basic EPS", "Normalized EPS"])
    if len(eps_from_fin) >= 2:
        return eps_from_fin

    try:
        eh = stock.earnings_history
    except Exception:
        return []

    if eh is None:
        return []
    try:
        if eh.empty or "epsActual" not in eh.columns:
            return []
    except Exception:
        return []

    try:
        df = eh.copy()
        if "asOfDate" in df.columns:
            years = pd.to_datetime(df["asOfDate"], errors="coerce").dt.year
        else:
            years = pd.to_datetime(df.index, errors="coerce").year

        work = pd.DataFrame({"year": years, "eps": pd.to_numeric(df["epsActual"], errors="coerce")})
        work = work.dropna(subset=["year", "eps"])
        if work.empty:
            return []

        yearly = work.groupby("year", as_index=True)["eps"].mean().sort_index()
        vals = yearly.tolist()
        return [float(v) for v in vals] if len(vals) >= 2 else []
    except Exception:
        return []


def _extract_auto_cagr_from_stock(stock) -> tuple[float, float, float, bool]:
    """Fallback CAGR otomatis dari annual report yfinance (live, tidak perlu simpan JSON)."""
    try:
        financials = stock.financials
    except Exception:
        financials = None

    ni = _extract_financial_series(financials, ["Net Income", "NetIncome", "Net Income Common Stockholders"])
    rev = _extract_financial_series(financials, ["Total Revenue", "TotalRevenue", "Operating Revenue"])
    eps = _extract_eps_series_for_auto_cagr(stock, financials)

    if len(ni) < 2 or len(rev) < 2 or len(eps) < 2:
        return 0.0, 0.0, 0.0, False

    return compute_cagr(ni), compute_cagr(rev), compute_cagr(eps), True


def _estimate_dividend_growth_from_history(stock, years: int = 5):
    """Estimasi growth dividen tahunan (%) dari histori pembayaran dividen.

    Dipakai sebagai fallback saat `info['dividendGrowth']` tidak tersedia/kurang representatif.
    """

    try:
        divs = stock.dividends
    except Exception:
        return None

    if divs is None or len(divs) == 0:
        return None

    try:
        # Aggregate ke total dividen per tahun
        yearly = divs.groupby(divs.index.year).sum()
    except Exception:
        return None

    if yearly is None or len(yearly) < 2:
        return None

    yearly = yearly.astype(float).replace([np.inf, -np.inf], np.nan).dropna()
    yearly = yearly[yearly > 0]
    if len(yearly) < 2:
        return None

    last_year = int(yearly.index.max())
    start_target = last_year - int(max(years, 1))
    window = yearly[yearly.index >= start_target]
    if len(window) < 2:
        window = yearly.tail(min(len(yearly), 6))
    if len(window) < 2:
        return None

    first_year = int(window.index.min())
    end_year = int(window.index.max())
    span = end_year - first_year
    if span <= 0:
        return None

    first_val = float(window.loc[first_year])
    end_val = float(window.loc[end_year])
    if first_val <= 0 or end_val <= 0:
        return None

    cagr = (end_val / first_val) ** (1.0 / span) - 1.0
    if not np.isfinite(cagr):
        return None
    return float(cagr * 100.0)


def _estimate_pbv_mean_3y_from_history(stock, bvp_per_share: float):
    """Estimasi rata-rata PBV 3 tahun dari histori harga.

    Historis BVP tidak selalu tersedia, sehingga BVP saat ini dipakai
    sebagai proxy untuk membentuk seri PBV historis.
    """

    try:
        bvp = float(bvp_per_share)
    except (TypeError, ValueError):
        return None

    if not np.isfinite(bvp) or bvp <= 0:
        return None

    try:
        hist_3y = stock.history(period="3y", interval="1mo")
    except Exception:
        return None

    if hist_3y is None or hist_3y.empty or "Close" not in hist_3y.columns:
        return None

    closes = pd.to_numeric(hist_3y["Close"], errors="coerce").replace([np.inf, -np.inf], np.nan).dropna()
    if closes.empty:
        return None

    pbv_series = closes / bvp
    pbv_series = pbv_series.replace([np.inf, -np.inf], np.nan).dropna()
    if pbv_series.empty:
        return None

    return float(pbv_series.mean())


def _compute_discount_score(
    down_from_high: float,
    rise_from_low: float,
    down_from_month: float,
    down_from_week: float,
    down_from_today: float,
) -> float:
    """Hitung discount score (0..1) dengan 5 metrik (value + momentum + noise)."""

    n_high52 = min(max(float(down_from_high or 0.0), 0.0) / 40.0, 1.0)
    n_low52 = max(0.0, 1.0 - (max(float(rise_from_low or 0.0), 0.0) / 50.0))
    n_month = min(max(float(down_from_month or 0.0), 0.0) / 10.0, 1.0)
    n_week = min(max(float(down_from_week or 0.0), 0.0) / 5.0, 1.0)
    n_today = min(max(float(down_from_today or 0.0), 0.0) / 2.0, 1.0)

    score = (
        (0.40 * n_high52)
        + (0.20 * n_low52)
        + (0.20 * n_month)
        + (0.15 * n_week)
        + (0.05 * n_today)
    )
    return float(max(0.0, min(score, 1.0)))


def _discount_label_from_score(discount_score: float) -> str:
    s = float(discount_score or 0.0)
    if s > 0.70:
        return "Diskon Sangat Tinggi"
    if s >= 0.50:
        return "Diskon Tinggi"
    if s >= 0.35:
        return "Diskon Sedang"
    if s >= 0.20:
        return "Diskon Oke"
    if s >= 0.10:
        return "Diskon Kecil"
    return "Tidak Diskon"


def _decision_engine(
    current_price,
    mos,
    roe,
    pbv,
    div_yield,
    down_from_high,
    rise_from_low,
    down_from_month,
    down_from_week,
    down_from_today,
):
    """Mesin keputusan untuk label diskon & dividen.

    VIKOR untuk keputusan BUY/NO BUY akan diterapkan
    di tingkat DataFrame (lihat _apply_vikor_buy_decision).

    Output:
    - buy_decision: placeholder (akan dioverride VIKOR jika memungkinkan)
    - discount_label: "Diskon Tinggi" / dst (berbasis discount score 5 metrik)
    - discount_score: skor diskon 0..1
    - dividend_label: "Dividen Tinggi" / dst
    """

    mos = float(mos or 0)
    roe = float(roe or 0)
    pbv = float(pbv or 0)
    div_yield = float(div_yield or 0) * 100 if 0 < float(div_yield or 0) < 1 else float(div_yield or 0 or 0)
    down_from_high = float(down_from_high or 0)

    # 1) Discount score advanced (value + momentum + noise)
    discount_score = _compute_discount_score(
        down_from_high=down_from_high,
        rise_from_low=rise_from_low,
        down_from_month=down_from_month,
        down_from_week=down_from_week,
        down_from_today=down_from_today,
    )
    discount_label = _discount_label_from_score(discount_score)

    # 2) Dividen
    if div_yield <= 0:
        dividend_label = "Tidak Ada Dividen"
    elif div_yield >= 5:
        dividend_label = "Dividen Tinggi"
    else:
        dividend_label = "Dividen Biasa"

    # Placeholder keputusan BUY (akan dioverride oleh TOPSIS jika ada >1 alternatif)
    # Tetap pakai logika lama sebagai fallback jika TOPSIS tidak bisa dijalankan.
    score = 0.0

    if mos >= 30:
        score += 3
    elif mos >= 20:
        score += 2
    elif mos >= 10:
        score += 1

    if roe >= 20:
        score += 3
    elif roe >= 15:
        score += 2
    elif roe >= 10:
        score += 1

    if pbv > 0:
        if pbv <= 1:
            score += 2
        elif pbv <= 2:
            score += 1

    if down_from_high >= 20:
        score += 1

    if div_yield >= 4:
        score += 1

    buy_decision = "BUY" if score >= 6 else "NO BUY"

    return buy_decision, discount_label, discount_score, dividend_label


def _apply_vikor_buy_decision(df: pd.DataFrame) -> pd.DataFrame:
    """Terapkan VIKOR untuk keputusan BUY/NO BUY (MCDM).

    Kriteria yang dipakai:
    - MOS (%)                : benefit (semakin besar semakin baik)
    - ROE (%)                : benefit
    - PBV                    : cost   (semakin kecil semakin baik)
    - Dividend Yield (%)     : benefit
    - Down From High 52 (%)  : benefit (semakin jauh dari high, diskon lebih besar)

    Hasil:
    - kolom baru 'VIKOR_Q' di df (semakin kecil semakin baik)
    - kolom 'Decision Buy' dioverride berdasarkan skor VIKOR
    """

    # Butuh minimal 2 alternatif untuk VIKOR yang bermakna
    if df is None or len(df) < 2:
        return df

    criteria_cols = [
        "MOS (%)",
        "ROE (%)",
        "PBV",
        "Dividend Yield (%)",
        "Down From High 52 (%)",
    ]

    # Pastikan semua kolom ada
    if not all(col in df.columns for col in criteria_cols):
        return df

    data = df[criteria_cols].astype(float).replace([np.inf, -np.inf], np.nan).fillna(0.0)

    # Bobot kriteria (total ~1.0)
    weights = np.array([0.3, 0.3, 0.15, 0.15, 0.1], dtype=float)

    benefit_cols = {"MOS (%)", "ROE (%)", "Dividend Yield (%)", "Down From High 52 (%)"}
    cost_cols = {"PBV"}

    # Hitung nilai terbaik & terburuk untuk tiap kriteria
    f_best = {}
    f_worst = {}

    for col in criteria_cols:
        col_values = data[col]
        if col in benefit_cols:
            f_best[col] = col_values.max()
            f_worst[col] = col_values.min()
        elif col in cost_cols:
            f_best[col] = col_values.min()
            f_worst[col] = col_values.max()
        else:
            f_best[col] = col_values.max()
            f_worst[col] = col_values.min()

    f_best = pd.Series(f_best)
    f_worst = pd.Series(f_worst)

    # Hitung S_i dan R_i
    S = pd.Series(0.0, index=data.index)
    R = pd.Series(0.0, index=data.index)

    for j, col in enumerate(criteria_cols):
        w = weights[j]
        best = f_best[col]
        worst = f_worst[col]
        denom = best - worst if col in benefit_cols else worst - best

        if denom == 0:
            term = pd.Series(0.0, index=data.index)
        else:
            if col in benefit_cols:
                term = (best - data[col]) / denom
            else:  # cost
                term = (data[col] - best) / denom

        weighted_term = w * term
        S += weighted_term
        R = pd.concat([R, weighted_term], axis=1).max(axis=1)

    S_star = S.min()
    S_minus = S.max()
    R_star = R.min()
    R_minus = R.max()

    v = 0.5  # kompromi antara majority dan individual regret

    # Hindari pembagian nol
    if S_minus == S_star:
        S_component = pd.Series(0.0, index=data.index)
    else:
        S_component = (S - S_star) / (S_minus - S_star)

    if R_minus == R_star:
        R_component = pd.Series(0.0, index=data.index)
    else:
        R_component = (R - R_star) / (R_minus - R_star)

    Q = v * S_component + (1 - v) * R_component

    df["VIKOR_Q"] = Q

    # Semakin kecil Q semakin baik. Gunakan median sebagai batas BUY.
    median_q = Q.median()
    df["Decision Buy"] = np.where(df["VIKOR_Q"] <= median_q, "BUY", "NO BUY")

    return df


def _apply_fuzzy_ahp_topsis_buy_decision(df: pd.DataFrame) -> pd.DataFrame:
    """Terapkan Hybrid FUZZY AHP-TOPSIS untuk keputusan BUY/NO BUY di dashboard.

    Menggunakan mesin yang sama dengan detailed CAGR (decision_making.py).
    Evaluasi dilakukan secara BATCH (semua ticker sekaligus) agar TOPSIS
    bisa membandingkan secara relatif antar ticker, bukan fallback absolut.

    Perbaikan vs versi sebelumnya:
    - Batch evaluation (bukan per-ticker)
    - down_from_high dimasukkan ke CagrResult
    - quality_score dan discount_score dimasukkan ke CagrResult
    - Quality gate: quality < 0.4 + BUY → downgrade ke NO BUY
    """

    if df is None or len(df) == 0:
        return df

    required_cols = [
        "MOS (%)",
        "ROE (%)",
        "PBV",
        "Dividend Yield (%)",
        "PER NOW",
    ]

    # Jika kolom penting tidak lengkap, biarkan keputusan lama apa adanya
    if not all(col in df.columns for col in required_cols):
        return df

    cagr_items = _load_cagr_items()

    _QUALITY_GATE_THRESHOLD = 0.4  # Quality di bawah ini → downgrade BUY ke NO BUY

    for idx, row in df.iterrows():
        ticker = str(row.get("Ticker") or row.get("Name") or "-")

        roe = float(row.get("ROE (%)") or 0.0)
        mos = float(row.get("MOS (%)") or 0.0)
        pbv = float(row.get("PBV") or 0.0)
        div_yield = float(row.get("Dividend Yield (%)") or 0.0)
        per = float(row.get("PER NOW") or 0.0)
        down_from_high = float(row.get("Down From High 52 (%)") or 0.0)
        qscore = float(row.get("Quality Score") or 0.0)
        discount_score = float(row.get("Discount Score") or 0.0)

        base_result = CagrResult(
            ticker=ticker,
            cagr_net_income=0.0,
            cagr_revenue=0.0,
            cagr_eps=0.0,
            roe=roe,
            mos=mos,
            pbv=pbv,
            div_yield=div_yield,
            per=per,
            down_from_high=down_from_high,
            quality_score=qscore,
            discount_score=discount_score,
        )
        base_eval = evaluate_cagr_methods([base_result], use_cagr=False)
        base_info = (((base_eval.get("methods") or {}).get("FUZZY_AHP_TOPSIS") or {}).get(ticker)) or {}
        base_decision = base_info.get("decision")
        base_score = base_info.get("score")
        base_category = base_info.get("category")

        cagr_net, cagr_rev, cagr_eps, has_cagr = _extract_cagr_for_ticker(ticker, cagr_items)
        cagr_source = "saved"

        if not has_cagr:
            auto_net = pd.to_numeric(row.get("Auto CAGR Net Income (%)"), errors="coerce")
            auto_rev = pd.to_numeric(row.get("Auto CAGR Revenue (%)"), errors="coerce")
            auto_eps = pd.to_numeric(row.get("Auto CAGR EPS (%)"), errors="coerce")
            if not pd.isna(auto_net) and not pd.isna(auto_rev) and not pd.isna(auto_eps):
                cagr_net = float(auto_net)
                cagr_rev = float(auto_rev)
                cagr_eps = float(auto_eps)
                has_cagr = True
                cagr_source = "auto_live"

        df.at[idx, "CAGR Applied"] = bool(has_cagr)
        df.at[idx, "CAGR Source"] = cagr_source if has_cagr else "none"
        if has_cagr:
            df.at[idx, "CAGR Net Income Used (%)"] = float(cagr_net)
            df.at[idx, "CAGR Revenue Used (%)"] = float(cagr_rev)
            df.at[idx, "CAGR EPS Used (%)"] = float(cagr_eps)
        if has_cagr:
            final_result = CagrResult(
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
                quality_score=qscore,
                discount_score=discount_score,
            )
            final_eval = evaluate_cagr_methods([final_result], use_cagr=True)
            final_info = (((final_eval.get("methods") or {}).get("FUZZY_AHP_TOPSIS") or {}).get(ticker)) or {}
        else:
            final_info = base_info

        final_decision = final_info.get("decision")
        final_score = final_info.get("score")
        final_category = final_info.get("category")

        # ── Quality Gate ──
        # Jika quality terlalu rendah, downgrade BUY ke NO BUY
        if qscore < _QUALITY_GATE_THRESHOLD:
            if base_decision == "BUY":
                base_decision = "NO BUY"
                base_category = "Don't Buy"
            if final_decision == "BUY":
                final_decision = "NO BUY"
                final_category = "Don't Buy"

        if base_decision:
            df.at[idx, "Decision Buy"] = base_decision
            df.at[idx, "Base Decision Buy"] = base_decision
        if base_score is not None:
            df.at[idx, "Hybrid Score"] = float(base_score)
            df.at[idx, "Base Hybrid Score"] = float(base_score)
        if base_category:
            df.at[idx, "Hybrid Category"] = str(base_category)
            df.at[idx, "Base Hybrid Category"] = str(base_category)
        df.at[idx, "Hybrid Mode"] = "no_cagr"

        if final_decision:
            df.at[idx, "Final Decision Buy"] = final_decision
        if final_score is not None:
            df.at[idx, "Final Hybrid Score"] = float(final_score)
        if final_category:
            df.at[idx, "Final Hybrid Category"] = str(final_category)
        df.at[idx, "Final Hybrid Mode"] = "with_cagr" if has_cagr else "no_cagr"

    return df


def _apply_payout_ratio_safety_check(df: pd.DataFrame) -> pd.DataFrame:
    """Safety check terakhir sebelum eksekusi beli memakai payout ratio.

    Option A (dividend growth-aware):
    - Ambil dividend growth dari yfinance.
    - Buat payout penalty yang lebih lunak jika dividend masih tumbuh.
    - Hindari HOLD misleading untuk kasus payout tinggi tapi dividen bertumbuh.
    """

    if df is None or len(df) == 0:
        return df

    if "Payout Ratio (%)" not in df.columns:
        df["Payout Ratio (%)"] = np.nan
    if "Dividend Growth (%)" not in df.columns:
        df["Dividend Growth (%)"] = np.nan

    out_decisions = []
    out_notes = []
    out_penalties = []

    for _, row in df.iterrows():
        raw_decision = str(row.get("Final Decision Buy") or row.get("Decision Buy") or "NO BUY").strip().upper()
        payout_raw = row.get("Payout Ratio (%)")
        div_growth_raw = row.get("Dividend Growth (%)")
        payout = pd.to_numeric(payout_raw, errors="coerce")
        div_growth = pd.to_numeric(div_growth_raw, errors="coerce")
        has_positive_div_growth = (not pd.isna(div_growth)) and float(div_growth) > 0

        if raw_decision != "BUY":
            out_decisions.append("NO BUY")
            out_notes.append("Final signal is NO BUY")
            out_penalties.append(None)
            continue

        if pd.isna(payout):
            out_decisions.append("BUY")
            out_notes.append("Payout ratio unavailable (manual check)")
            out_penalties.append(None)
            continue

        payout = float(payout)

        if payout < 0:
            out_decisions.append("HOLD")
            out_notes.append("Payout ratio invalid (< 0%)")
            out_penalties.append(0.2)
            continue

        # Opsi A: payout penalty berbasis dividend growth.
        payout_penalty = (
            1.0
            if payout <= 70
            else (
                0.85
                if payout <= 85
                else (
                    0.75
                    if (payout <= 95 and has_positive_div_growth)
                    else (
                        0.50
                        if payout <= 95
                        else (0.60 if has_positive_div_growth else 0.20)
                    )
                )
            )
        )

        out_penalties.append(float(payout_penalty))

        if payout_penalty >= 0.55:
            out_decisions.append("BUY")
            if payout > 95 and has_positive_div_growth:
                out_notes.append("Very high payout, but dividend still growing")
            elif payout > 85:
                out_notes.append("Elevated payout, still acceptable")
            else:
                out_notes.append("Payout ratio within safety range")
        else:
            out_decisions.append("HOLD")
            if payout > 95:
                out_notes.append("Payout too high and dividend not growing")
            else:
                out_notes.append("Payout pressure too high")

    df["Execution Decision"] = out_decisions
    df["Safety Check"] = out_notes
    df["Payout Penalty"] = out_penalties

    # --- SOLVENCY QUALITY GATE ---
    # Downgrade decision if Debt-to-Equity is dangerously high and liquidity is low
    for idx, row in df.iterrows():
        # Only evaluate if the current execution decision is BUY
        if df.at[idx, "Execution Decision"] == "BUY":
            de_raw = pd.to_numeric(row.get("Debt To Equity (%)"), errors="coerce")
            cr_raw = pd.to_numeric(row.get("Current Ratio"), errors="coerce")
            
            de_pct = float(de_raw) if not pd.isna(de_raw) else 0.0
            cur_ratio = float(cr_raw) if not pd.isna(cr_raw) else 1.0 # assume safe if nan
            sector_lower = str(row.get("Sector") or "").lower()
            is_fin = sector_lower in ["financial services", "financials", "bank"]

            # Banking/Financials naturally run high leverage, exclude them from standard D/E penalty
            if not is_fin:
                current_note = str(df.at[idx, "Safety Check"])
                # If critically leveraged (D/E > 200% AND weak liquidity CR < 1.0)
                if de_pct > 200.0 and cur_ratio < 1.0:
                    df.at[idx, "Execution Decision"] = "HOLD"
                    df.at[idx, "Safety Check"] = f"[SOLVENCY HOLD] D/E {de_pct / 100:.2f}x & CR {cur_ratio:.2f}. " + current_note
                # If insanely leveraged (D/E > 350%) -> Toxic debt trap
                elif de_pct > 350.0:
                    df.at[idx, "Execution Decision"] = "NO BUY"
                    df.at[idx, "Safety Check"] = f"[DANGER NO BUY] Toxic Debt: D/E {de_pct / 100:.2f}x. " + current_note

    return df


def get_stock_data(ticker_list):
    all_data = []
    
    for symbol in ticker_list:
        print(f"Mengambil data untuk: {symbol}...")
        stock = yf.Ticker(symbol)

        # Beberapa field dari yfinance bisa None, jadi kita normalisasi dulu
        is_rate_limited = False
        try:
            info = stock.get_info()
        except Exception as e:
            if 'RateLimitError' in type(e).__name__ or 'Too Many Requests' in str(e) or '429' in str(e):
                is_rate_limited = True
            print(f"Error mengambil data '{symbol}': {e}")
            info = {}
        
        # 1. Data Dasar & Harga (Tabel Kuning)
        current_price = info.get('currentPrice') or 0
        high_52 = info.get('fiftyTwoWeekHigh') or 0
        low_52 = info.get('fiftyTwoWeekLow') or 0
        
        # 2. Data Fundamental (Tabel Hijau)
        eps = info.get('trailingEps') or 0
        bvp_per_s = info.get('bookValue') or 0

        roe_raw = info.get('returnOnEquity')
        roe = float(roe_raw) * 100 if isinstance(roe_raw, (int, float)) else 0  # ke %

        pbv = info.get('priceToBook') or 0
        per = info.get('trailingPE') or 0
        market_cap = info.get('marketCap') or 0
        shares = info.get('sharesOutstanding') or 0
        fcf = info.get('freeCashflow') or 0

        div_yield = info.get('dividendYield')
        payout_ratio_raw = info.get('payoutRatio')
        div_growth_raw = info.get('dividendGrowth')
        payout_ratio = _normalize_percent_value(payout_ratio_raw)
        div_growth = _normalize_percent_value(div_growth_raw)

        auto_cagr_net, auto_cagr_rev, auto_cagr_eps, auto_cagr_has = _extract_auto_cagr_from_stock(stock)

        quality_info = dict(info) if isinstance(info, dict) else {}
        de_info_raw = quality_info.get('debtToEquity')
        de_info_num = _normalize_debt_to_equity_value(de_info_raw)
        if de_info_num is None or not np.isfinite(de_info_num):
            de_fallback = _estimate_debt_to_equity_from_balance_sheet(stock)
            if de_fallback is not None and np.isfinite(de_fallback):
                quality_info['debtToEquity'] = float(de_fallback)

        quality = _compute_quality_profile(info=quality_info, roe_pct=roe, market_cap=float(market_cap or 0.0))

        # Fallback: beberapa ticker tidak mengisi `dividendGrowth` secara konsisten
        # di `info`, jadi hitung estimasi growth dari histori dividen 5 tahun.
        if div_growth is None or not np.isfinite(div_growth) or div_growth <= 0:
            hist_div_growth = _estimate_dividend_growth_from_history(stock, years=5)
            if hist_div_growth is not None and np.isfinite(hist_div_growth):
                div_growth = float(hist_div_growth)

        
        # 3. Perhitungan Kustom (Kalkulasi Otomatis)
        # MOS Graham (sudah ada)
        if eps > 0 and bvp_per_s > 0:
            graham = np.sqrt(22.5 * eps * bvp_per_s)
            mos_graham = ((graham - current_price) / graham) * 100
        else:
            graham = 0
            mos_graham = 0.0

        # MOS PBV historis (3Y):
        # jika PBV sekarang < rerata historis, berarti lebih murah (MOS PBV positif).
        pbv_now = 0.0
        try:
            pbv_now = float(pbv)
        except (TypeError, ValueError):
            pbv_now = 0.0
        if not np.isfinite(pbv_now) or pbv_now <= 0:
            pbv_now = 0.0

        if pbv_now <= 0 and bvp_per_s and float(bvp_per_s) > 0:
            pbv_now = float(current_price) / float(bvp_per_s)

        pbv_mean_3y = _estimate_pbv_mean_3y_from_history(stock, bvp_per_s)
        if pbv_mean_3y is not None and np.isfinite(pbv_mean_3y) and pbv_mean_3y > 0 and pbv_now > 0:
            mos_pbv = ((pbv_mean_3y - pbv_now) / pbv_mean_3y) * 100
        else:
            mos_pbv = mos_graham

        # Hybrid MOS dengan bobot sektor:
        # - Perbankan: PBV lebih dominan (Graham kurang relevan)
        # - Teknologi/Aset Ringan: Graham sangat tidak relevan (Intangible assets besar). Gunakan PBV historis atau metriks lain.
        # - Sektor Lain: Graham lebih dominan.
        sector_lower = str(info.get('sector') or "").lower()
        is_bank = bool(quality.get('is_bank')) or sector_lower in ["financial services", "financials", "bank"]
        is_tech = sector_lower in ["technology", "communication services"]

        has_graham = np.isfinite(mos_graham) and graham > 0
        has_pbv = np.isfinite(mos_pbv)

        if is_tech and has_pbv:
            mos = float(mos_pbv) # Completely disregard Graham for Tech
        elif has_graham and has_pbv:
            if is_bank:
                mos = (0.2 * mos_graham) + (0.8 * mos_pbv)
            else:
                mos = (0.8 * mos_graham) + (0.2 * mos_pbv)
        elif has_pbv:
            mos = float(mos_pbv)
        else:
            mos = float(mos_graham)
            
        # Down from High (berapa % di bawah high)
        down_from_high = ((high_52 - current_price) / high_52) * 100 if high_52 > 0 else 0
        rise_from_low = ((current_price - low_52) / low_52) * 100 if low_52 > 0 else 0

        # Short-horizon drawdown (signed):
        # jika harga NAIK vs anchor period, nilai jadi negatif.
        # contoh: naik 9% => Down From ... = -9%
        down_from_month_high = 0.0
        down_from_week_high = 0.0
        down_from_today = 0.0

        try:
            hist_1mo = stock.history(period="1mo", interval="1d")
        except Exception:
            hist_1mo = None

        month_anchor = 0.0
        week_anchor = 0.0
        if hist_1mo is not None and not hist_1mo.empty:
            # Anchor bulanan = Open pertama pada window 1 bulan
            if "Open" in hist_1mo.columns:
                month_anchor = float(hist_1mo.iloc[0].get("Open") or 0.0)

            # Anchor mingguan = Open pertama dari 5 hari trading terakhir
            last_5 = hist_1mo.tail(5)
            if not last_5.empty and "Open" in last_5.columns:
                week_anchor = float(last_5.iloc[0].get("Open") or 0.0)

        # Anchor harian = Open hari ini
        day_anchor = float(info.get('open') or 0.0)

        # Rumus signed drawdown: (anchor - current) / anchor
        # current > anchor => negatif (harga naik)
        if month_anchor > 0:
            down_from_month_high = ((month_anchor - current_price) / month_anchor) * 100
        if week_anchor > 0:
            down_from_week_high = ((week_anchor - current_price) / week_anchor) * 100
        if day_anchor > 0:
            down_from_today = ((day_anchor - current_price) / day_anchor) * 100

        # 4. Mesin Keputusan (BUY / Diskon / Dividen)
        buy_decision, discount_label, discount_score, dividend_label = _decision_engine(
            current_price=current_price,
            mos=mos,
            roe=roe,
            pbv=pbv,
            div_yield=div_yield,
            down_from_high=down_from_high,
            rise_from_low=rise_from_low,
            down_from_month=down_from_month_high,
            down_from_week=down_from_week_high,
            down_from_today=down_from_today,
        )

        # Menyusun data ke dalam dictionary
        data = {
            'Ticker': symbol,
            'Name': info.get('shortName', symbol),
            'Sector': info.get('sector') or '-',
            'Industry': info.get('industry') or '-',
            'Price': current_price,
            'Revenue Annual (Prev)': info.get('totalRevenue') or 0,
            'EPS NOW': eps,
            'PER NOW': per,
            'HIGH 52': high_52,
            'LOW 52': low_52,
            'Shares': shares,
            'Market Cap': market_cap,
            'Down From High 52 (%)': round(down_from_high, 2),
            'Down From This Month (%)': round(down_from_month_high, 2),
            'Down From This Week (%)': round(down_from_week_high, 2),
            'Down From Today (%)': round(down_from_today, 2),
            'Rise From Low 52 (%)': round(rise_from_low, 2),
            'BVP Per S': bvp_per_s,
            'ROE (%)': round(roe, 2),
            'Graham Number': round(graham, 2),
            'MOS (%)': round(mos, 2),
            'Free Cashflow': fcf,
            'PBV': pbv,
            'PBV Mean 3Y': round(pbv_mean_3y, 3) if pbv_mean_3y is not None and np.isfinite(pbv_mean_3y) else None,
            'MOS Graham (%)': round(float(mos_graham), 2) if np.isfinite(mos_graham) else None,
            'MOS PBV (%)': round(float(mos_pbv), 2) if np.isfinite(mos_pbv) else None,
            'Net Profit Margin (%)': round(quality.get('npm_pct'), 2) if quality.get('npm_pct') is not None else None,
            'Debt To Equity (%)': round(quality.get('debt_to_equity_pct'), 2) if quality.get('debt_to_equity_pct') is not None else None,
            'Current Ratio': round(quality.get('current_ratio'), 2) if quality.get('current_ratio') is not None else None,
            'Quality Score': round(float(quality.get('score') or 0.0), 3),
            'Quality Label': quality.get('label') or '-',
            'Dividend Yield (%)': div_yield,
            'Dividend Growth (%)': round(div_growth, 2) if div_growth is not None else None,
            'Payout Ratio (%)': round(payout_ratio, 2) if payout_ratio is not None else None,
            'Auto CAGR Net Income (%)': round(float(auto_cagr_net), 3) if auto_cagr_has else None,
            'Auto CAGR Revenue (%)': round(float(auto_cagr_rev), 3) if auto_cagr_has else None,
            'Auto CAGR EPS (%)': round(float(auto_cagr_eps), 3) if auto_cagr_has else None,
            'Decision Buy': buy_decision,
            'Decision Discount': discount_label,
            'Discount Score': round(float(discount_score), 3),
            'Decision Dividend': dividend_label,
            'Is Rate Limited': is_rate_limited
        }
        all_data.append(data)
    
    df = pd.DataFrame(all_data)

    # Terapkan Hybrid FUZZY AHP-TOPSIS untuk keputusan BUY/NO BUY
    df = _apply_fuzzy_ahp_topsis_buy_decision(df)
    df = _apply_payout_ratio_safety_check(df)
    df = _apply_quality_verdict(df)
    df = _apply_discount_timing_verdict(df)

    return df

if __name__ == "__main__":
    # Contoh manual jika file ini dijalankan langsung
    tickers_to_check = [
        "BBCA.JK",
        "BBRI.JK",
        "BMRI.JK",
        "BBNI.JK",
        "ASII.JK",
        "TLKM.JK",
        "MPMX.JK",
        "PTBA.JK",
        "RALS.JK",
    ]

    df_saham = get_stock_data(tickers_to_check)

    print("\n--- Hasil Mesin Decision Saham ---")
    print(df_saham[[
        'Name', 'Price', 'ROE (%)', 'MOS (%)', 'PBV',
        'Decision Buy', 'Decision Discount', 'Decision Dividend',
    ]])
    print("\n--- Data Lengkap ---")
    print(df_saham.to_string())

    # Simpan ke Excel jika perlu
    # df_saham.to_excel("update_saham.xlsx", index=False)