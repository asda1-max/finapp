from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Sequence
import json
import threading

import numpy as np
import os


_data_dir_env = os.environ.get("FINAPP_DATA_DIR")
if _data_dir_env:
    _data_dir = Path(_data_dir_env)
    _data_dir.mkdir(parents=True, exist_ok=True)
    THRESHOLDS_JSON_PATH = _data_dir / "thresholds.json"
else:
    THRESHOLDS_JSON_PATH = Path(__file__).with_name("thresholds.json")

# ---------------------------------------------------------------------------
# Thresholds cache — avoids re-reading thresholds.json on every scoring call.
# The cache is invalidated by _invalidate_thresholds_cache() which fastapi_app
# calls after each successful write to thresholds.json.
# ---------------------------------------------------------------------------
_THRESHOLDS_CACHE: dict | None = None
_THRESHOLDS_CACHE_LOCK = threading.Lock()


def _invalidate_thresholds_cache() -> None:
    """Force the next read of thresholds.json to hit the filesystem."""
    global _THRESHOLDS_CACHE
    with _THRESHOLDS_CACHE_LOCK:
        _THRESHOLDS_CACHE = None


def _load_thresholds_cached() -> dict:
    """Return parsed thresholds.json, using the module-level cache."""
    global _THRESHOLDS_CACHE
    with _THRESHOLDS_CACHE_LOCK:
        if _THRESHOLDS_CACHE is not None:
            return _THRESHOLDS_CACHE
        try:
            raw = json.loads(THRESHOLDS_JSON_PATH.read_text(encoding="utf-8")) if THRESHOLDS_JSON_PATH.exists() else {}
        except (json.JSONDecodeError, OSError):
            raw = {}
        _THRESHOLDS_CACHE = raw if isinstance(raw, dict) else {}
        return _THRESHOLDS_CACHE


# Sentinel untuk membedakan "data tidak tersedia" vs "nilainya memang 0".
# Jika field fundamental di CagrResult di-set ke _NONE_SENTINEL,
# normalisasi akan menggunakan 0.5 (netral) alih-alih 0 (hukuman).
_NONE_SENTINEL = float("nan")


def _is_none_sentinel(v: float) -> bool:
    """Cek apakah value adalah sentinel 'data tidak tersedia'."""
    import math
    return v is None or (isinstance(v, float) and math.isnan(v))


@dataclass
class CagrResult:
    ticker: str
    cagr_net_income: float
    cagr_revenue: float
    cagr_eps: float
    # Tambahan faktor fundamental dari data.py
    roe: float = 0.0
    mos: float = 0.0
    pbv: float = 0.0
    div_yield: float = 0.0
    per: float = 0.0
    down_from_high: float = 0.0
    # Quality score (0..1) dari data.py, opsional
    quality_score: float = _NONE_SENTINEL
    # Discount score (0..1) dari data.py, opsional
    discount_score: float = _NONE_SENTINEL


def compute_cagr(values: Sequence[float]) -> float:
    """Hitung CAGR dalam persen dari deret nilai tahunan.

    values diharapkan urut dari paling lama -> paling baru.
    Jika data tidak valid (kurang dari 2 titik atau nilai awal/non-positif), balas 0.
    """

    vals = [float(v) for v in values if v is not None]
    if len(vals) < 2:
        return 0.0
    first, last = vals[0], vals[-1]
    if first <= 0 or last <= 0:
        return 0.0
    years = len(vals) - 1
    try:
        cagr = (last / first) ** (1.0 / years) - 1.0
    except ZeroDivisionError:
        return 0.0
    return float(cagr * 100.0)


def _normalize_cagr(v: float) -> float:
    """Normalisasi CAGR (dalam %) ke rentang 0..1.

    Asumsi sederhana:
    - <= 0%   -> 0
    - >= 25%  -> 1
    - lainya  -> linear di antara 0 dan 25.
    """

    if v <= 0:
        return 0.0
    if v >= 25.0:
        return 1.0
    return float(v / 25.0)


def _build_normalized_matrix(results: List[CagrResult]) -> np.ndarray:
    """Bangun matriks ternormalisasi (0..1) dengan urutan kolom:
    [CAGR_EPS, CAGR_NET_INCOME, CAGR_REVENUE].
    """

    data = []
    for r in results:
        row = [
            _normalize_cagr(r.cagr_eps),
            _normalize_cagr(r.cagr_net_income),
            _normalize_cagr(r.cagr_revenue),
        ]
        data.append(row)
    if not data:
        return np.zeros((0, 3), dtype=float)
    return np.array(data, dtype=float)


def _build_full_matrix(results: List[CagrResult]) -> np.ndarray:
    """Bangun matriks ternormalisasi 0..1 yang menggabungkan CAGR + fundamental.

    Struktur mengikuti 3 kelompok utama (Value & Growth investing):

    1) Profitabilitas & Efisiensi (40%):
       - ROE
       - Net Income CAGR
       - Dividend Yield

    2) Valuasi & Margin of Safety (35%):
       - MOS
       - PBV (diubah ke skor murah/mahal)
       - PER (diubah ke skor murah/mahal)

    3) Growth (25%):
       - Revenue CAGR
       - EPS CAGR

    Urutan kolom matriks:
    [
      ROE,
      CAGR_NET_INCOME,
      Dividend_Yield,
      MOS,
      PBV_Score,
      PER_Score,
      CAGR_REVENUE,
      CAGR_EPS,
    ]
    """

    _NEUTRAL = 0.5  # Skor netral untuk data yang tidak tersedia

    rows = []
    for r in results:
        eps_n = _normalize_cagr(r.cagr_eps)
        net_n = _normalize_cagr(r.cagr_net_income)
        rev_n = _normalize_cagr(r.cagr_revenue)

        # ROE normalisasi 0..30% -> 0..1
        if _is_none_sentinel(r.roe):
            roe_n = _NEUTRAL
        else:
            roe_raw = float(r.roe or 0.0)
            roe_n = max(0.0, min(roe_raw, 30.0)) / 30.0

        # MOS normalisasi 0..80% -> 0..1, negatif dianggap 0
        if _is_none_sentinel(r.mos):
            mos_n = _NEUTRAL
        else:
            mos_raw = float(r.mos or 0.0)
            mos_raw = max(0.0, mos_raw)
            mos_n = max(0.0, min(mos_raw, 80.0)) / 80.0

        # PBV: lebih kecil lebih baik. <=1 ->1, >=4 ->0, linear di antaranya
        if _is_none_sentinel(r.pbv):
            pbv_score = _NEUTRAL
        else:
            pbv_raw = float(r.pbv or 0.0)
            if pbv_raw <= 0:
                pbv_score = 0.0
            elif pbv_raw <= 1.0:
                pbv_score = 1.0
            elif pbv_raw >= 4.0:
                pbv_score = 0.0
            else:
                pbv_score = (4.0 - pbv_raw) / (4.0 - 1.0)

        # Dividend yield 0..10% -> 0..1
        if _is_none_sentinel(r.div_yield):
            dy_n = _NEUTRAL
        else:
            dy_raw = float(r.div_yield or 0.0)
            dy_raw = max(0.0, dy_raw)
            dy_n = max(0.0, min(dy_raw, 10.0)) / 10.0

        # PER: lebih kecil lebih baik. Kita asumsikan 5..25x sebagai rentang
        # relevan. PER <=5 dianggap sangat murah (skor 1), PER >=25 dianggap
        # mahal (skor 0), di antaranya linear.
        if _is_none_sentinel(r.per):
            per_score = _NEUTRAL
        else:
            per_raw = float(r.per or 0.0)
            if per_raw <= 0:
                per_score = 0.0
            elif per_raw <= 5.0:
                per_score = 1.0
            elif per_raw >= 25.0:
                per_score = 0.0
            else:
                per_score = (25.0 - per_raw) / (25.0 - 5.0)

        rows.append([roe_n, net_n, dy_n, mos_n, pbv_score, per_score, rev_n, eps_n])

    if not rows:
        return np.zeros((0, 8), dtype=float)
    return np.array(rows, dtype=float)


def _saw_scores(norm_matrix: np.ndarray, weights: np.ndarray) -> np.ndarray:
    """SAW: skor = jumlah bobot * nilai ternormalisasi."""

    return (norm_matrix * weights).sum(axis=1)


def _ahp_criteria_weights() -> np.ndarray:
    """Bobot kriteria dari matriks perbandingan berpasangan AHP.

    Urutan kriteria: [EPS, Net Income, Revenue]
    Di sini diasumsikan EPS sedikit lebih penting dari Net Income,
    dan Net Income lebih penting dari Revenue.
    """

    pairwise = np.array(
        [
            [1.0, 3.0, 4.0],   # EPS
            [1.0 / 3.0, 1.0, 2.0],  # Net Income
            [1.0 / 4.0, 1.0 / 2.0, 1.0],  # Revenue
        ],
        dtype=float,
    )
    eigvals, eigvecs = np.linalg.eig(pairwise)
    idx = np.argmax(eigvals.real)
    w = eigvecs[:, idx].real
    w = np.maximum(w, 0)
    s = w.sum()
    if s == 0:
        return np.array([1 / 3, 1 / 3, 1 / 3], dtype=float)
    return w / s


def _topsis_scores(norm_matrix: np.ndarray, weights: np.ndarray) -> np.ndarray:
    """TOPSIS di atas matriks ternormalisasi 0..1.

    Ideal terbaik = 1 untuk semua kriteria, terburuk = 0.
    Skor = kedekatan ke solusi ideal (0..1, makin besar makin baik).
    """

    if norm_matrix.size == 0:
        return np.array([], dtype=float)

    weighted = norm_matrix * weights

    # Karena semua kriteria sudah dibentuk sebagai benefit 0..1,
    # solusi ideal positif = nilai tertinggi tiap kolom,
    # solusi ideal negatif = nilai terendah tiap kolom.
    # (Bukan vector 1.0 konstan, karena setelah weighting nilai maksimum
    #  realistis tiap kolom adalah bobot kolom tersebut.)
    ideal_best = weighted.max(axis=0)
    ideal_worst = weighted.min(axis=0)

    def _absolute_topsis_quality(matrix: np.ndarray, w: np.ndarray) -> np.ndarray:
        """Fallback TOPSIS absolut terhadap anchor tetap.

        Positive ideal  = w (setara semua kriteria = 1 setelah weighting)
        Negative ideal  = 0
        """

        weighted_local = matrix * w
        pos = w
        neg = np.zeros_like(w)
        d_pos = np.sqrt(((weighted_local - pos) ** 2).sum(axis=1))
        d_neg = np.sqrt(((weighted_local - neg) ** 2).sum(axis=1))
        den = d_pos + d_neg
        out = np.zeros_like(d_pos)
        valid_local = den > 0
        out[valid_local] = d_neg[valid_local] / den[valid_local]
        return out

    # Edge case: jika semua alternatif identik (mis. cuma 1 ticker),
    # gunakan TOPSIS absolut (bukan SAW) agar tetap berbeda dari SAW/VIKOR.
    if np.allclose(ideal_best, ideal_worst):
        return _absolute_topsis_quality(norm_matrix, weights)

    dist_best = np.sqrt(((weighted - ideal_best) ** 2).sum(axis=1))
    dist_worst = np.sqrt(((weighted - ideal_worst) ** 2).sum(axis=1))
    denom = dist_best + dist_worst

    closeness = np.zeros_like(dist_best)
    valid = denom > 0
    closeness[valid] = dist_worst[valid] / denom[valid]

    # Jika ada baris degenerate individual, fallback ke TOPSIS absolut.
    if np.any(~valid):
        fallback = _absolute_topsis_quality(norm_matrix, weights)
        closeness[~valid] = fallback[~valid]

    return closeness


def _vikor_scores(norm_matrix: np.ndarray, weights: np.ndarray, v: float = 0.5) -> np.ndarray:
    """VIKOR di atas matriks ternormalisasi 0..1.

    Semua kriteria dianggap benefit (semakin besar semakin baik).
    Menghasilkan skor 0..1 (dihitung sebagai 1 - Q, jadi makin besar makin baik).
    """

    if norm_matrix.size == 0:
        return np.array([], dtype=float)

    # f* = 1, f- = 0 untuk semua kriteria karena sudah dinormalisasi
    f_best = 1.0
    f_worst = 0.0

    # Deviasi tertimbang untuk setiap alternatif & kriteria
    # E_ij = w_j * (f* - f_ij) / (f* - f-) = w_j * (1 - f_ij)
    E = weights * (1.0 - norm_matrix)

    S = E.sum(axis=1)        # jumlah deviasi
    R = E.max(axis=1)        # regret maksimum

    S_star, S_minus = S.min(), S.max()
    R_star, R_minus = R.min(), R.max()

    if np.isclose(S_minus, S_star):
        S_comp = np.zeros_like(S)
    else:
        S_comp = (S - S_star) / (S_minus - S_star)

    if np.isclose(R_minus, R_star):
        R_comp = np.zeros_like(R)
    else:
        R_comp = (R - R_star) / (R_minus - R_star)

    Q = v * S_comp + (1.0 - v) * R_comp

    # Konversi ke skor (semakin besar semakin baik)
    Q_min, Q_max = Q.min(), Q.max()

    def _absolute_vikor_quality(matrix: np.ndarray, w: np.ndarray, vv: float) -> np.ndarray:
        """Fallback VIKOR absolut berbasis jarak ke ideal tetap (1.0)."""

        E_local = w * (1.0 - matrix)
        S_local = E_local.sum(axis=1)
        R_local = E_local.max(axis=1)
        q_local = vv * S_local + (1.0 - vv) * R_local
        score_local = 1.0 - q_local
        return np.clip(score_local, 0.0, 1.0)

    # Jika alternatif tidak bisa diperingkat secara relatif (single ticker
    # atau semua identik), gunakan fallback VIKOR absolut.
    if np.isclose(Q_max, Q_min):
        return _absolute_vikor_quality(norm_matrix, weights, v)

    scores = 1.0 - (Q - Q_min) / (Q_max - Q_min)
    return scores


def _method_saw_scores(norm_matrix: np.ndarray) -> np.ndarray:
    base_weights = np.array([0.4, 0.3, 0.3], dtype=float)
    base_weights = base_weights / base_weights.sum()
    return _saw_scores(norm_matrix, base_weights)


def _method_ahp_scores(norm_matrix: np.ndarray) -> np.ndarray:
    ahp_weights = _ahp_criteria_weights()
    return _saw_scores(norm_matrix, ahp_weights)


def _method_topsis_scores(norm_matrix: np.ndarray) -> np.ndarray:
    base_weights = np.array([0.4, 0.3, 0.3], dtype=float)
    base_weights = base_weights / base_weights.sum()
    return _topsis_scores(norm_matrix, base_weights)


def _method_vikor_scores(norm_matrix: np.ndarray) -> np.ndarray:
    base_weights = np.array([0.4, 0.3, 0.3], dtype=float)
    base_weights = base_weights / base_weights.sum()
    return _vikor_scores(norm_matrix, base_weights)


def _hybrid_config(use_cagr: bool) -> tuple[np.ndarray, float, float, float]:
    """Return (weights, recommended_thr, buy_thr, risk_thr) for hybrid mode.

    Mendukung override dari `thresholds.json`:
    - hybrid_weights.use_cagr / hybrid_weights.no_cagr
    - hybrid.use_cagr / hybrid.no_cagr (recommended, buy, risk)
    """

    if use_cagr:
        default_weights = np.array([
            0.18,  # ROE
            0.06,  # Net Income CAGR
            0.12,  # Dividend Yield
            0.20,  # MOS
            0.15,  # PBV Score
            0.15,  # PER Score
            0.08,  # Revenue CAGR
            0.12,  # EPS CAGR
        ], dtype=float)
        default_thr = (0.52, 0.44, 0.34)
        mode_key = "use_cagr"
    else:
        default_weights = np.array([
            0.20,  # ROE
            0.00,  # Net Income CAGR disabled
            0.10,  # Dividend Yield
            0.30,  # MOS
            0.20,  # PBV Score
            0.20,  # PER Score
            0.00,  # Revenue CAGR disabled
            0.00,  # EPS CAGR disabled
        ], dtype=float)
        default_thr = (0.655, 0.555, 0.455)
        mode_key = "no_cagr"

    weights = default_weights.copy()
    recommended_thr, buy_thr, risk_thr = default_thr

    raw = _load_thresholds_cached()

    if isinstance(raw, dict):
        w_cfg = raw.get("hybrid_weights") if isinstance(raw.get("hybrid_weights"), dict) else {}
        w_raw = w_cfg.get(mode_key)
        if isinstance(w_raw, list) and len(w_raw) == 8:
            try:
                w = np.array([float(x) for x in w_raw], dtype=float)
                if np.all(np.isfinite(w)) and np.all(w >= 0) and float(w.sum()) > 0:
                    weights = w
            except (TypeError, ValueError):
                pass

        h_cfg = raw.get("hybrid") if isinstance(raw.get("hybrid"), dict) else {}
        mode_thr = h_cfg.get(mode_key) if isinstance(h_cfg.get(mode_key), dict) else {}
        rec = mode_thr.get("recommended")
        buy = mode_thr.get("buy")
        risk = mode_thr.get("risk")
        try:
            if rec is not None and buy is not None and risk is not None:
                rec_f = float(rec)
                buy_f = float(buy)
                risk_f = float(risk)
                if 0.0 <= risk_f <= buy_f <= rec_f <= 1.0:
                    recommended_thr, buy_thr, risk_thr = rec_f, buy_f, risk_f
        except (TypeError, ValueError):
            pass

    return weights, recommended_thr, buy_thr, risk_thr


def _method_hybrid_scores(full_matrix: np.ndarray, use_cagr: bool) -> tuple[np.ndarray, float, float, float]:
    weights, rec_thr, buy_thr, risk_thr = _hybrid_config(use_cagr)
    weights = weights / weights.sum()
    scores = _topsis_scores(full_matrix, weights) if full_matrix.size else np.array([], dtype=float)
    return scores, rec_thr, buy_thr, risk_thr


def _load_method_thresholds(method: str) -> dict:
    """Baca threshold untuk metode tertentu dari thresholds.json.

    Fallback ke dict kosong jika file tidak ada atau method tidak ditemukan.
    Caller bertanggung jawab menyediakan default via .get(key, default).
    """
    raw = _load_thresholds_cached()
    methods = raw.get("methods") if isinstance(raw.get("methods"), dict) else {}
    cfg = methods.get(method) if isinstance(methods.get(method), dict) else {}
    return cfg


def _decision_saw(score, mos):
    cfg = _load_method_thresholds("SAW")
    buy = float(cfg.get("buy", 0.365))
    mos_boost = float(cfg.get("mos_boost_buy", 0.300))
    mos_trigger = float(cfg.get("mos_trigger", 15.0))
    return "BUY" if score >= buy or (mos > mos_trigger and score >= mos_boost) else "NO BUY"

def _decision_ahp(score, mos):
    cfg = _load_method_thresholds("AHP")
    buy = float(cfg.get("buy", 0.430))
    mos_boost = float(cfg.get("mos_boost_buy", 0.360))
    mos_trigger = float(cfg.get("mos_trigger", 15.0))
    return "BUY" if score >= buy or (mos > mos_trigger and score >= mos_boost) else "NO BUY"

def _decision_topsis(score, mos):
    cfg = _load_method_thresholds("TOPSIS")
    buy = float(cfg.get("buy", 0.405))
    mos_boost = float(cfg.get("mos_boost_buy", 0.330))
    mos_trigger = float(cfg.get("mos_trigger", 15.0))
    return "BUY" if score >= buy or (mos > mos_trigger and score >= mos_boost) else "NO BUY"

def _decision_vikor(score, mos):
    cfg = _load_method_thresholds("VIKOR")
    buy = float(cfg.get("buy", 0.450))
    mos_boost = float(cfg.get("mos_boost_buy", 0.370))
    mos_trigger = float(cfg.get("mos_trigger", 15.0))
    return "BUY" if score >= buy or (mos > mos_trigger and score >= mos_boost) else "NO BUY"


def _decision_hybrid(score: float, use_cagr: bool) -> tuple[str, str]:
    _, rec_thr, buy_thr, risk_thr = _hybrid_config(use_cagr)

    if score > rec_thr:
        category = "Recommended to Buy"
    elif score >= buy_thr:
        category = "Buy"
    elif score >= risk_thr:
        category = "Buy with Risk"
    else:
        category = "Don't Buy"

    decision = "BUY" if score >= buy_thr else "NO BUY"
    return decision, category


def evaluate_cagr_methods(
    results: List[CagrResult],
    *,
    use_cagr: bool = True,
) -> Dict[str, Dict[str, Dict[str, float]]]:
    """Hitung skor & keputusan BUY/NO BUY dengan VIKOR, TOPSIS, AHP, dan SAW.

    Mengembalikan struktur:
    {
      "cagr": {ticker: {"net_income": .., "revenue": .., "eps": ..}},
      "methods": {
         "VIKOR": {ticker: {"score": .., "decision": "BUY"/"NO BUY"}},
         "TOPSIS": {...},
         "SAW": {...},
         "AHP": {...},
      }
    }
    """

    if not results:
        return {
            "cagr": {},
            "methods": {"VIKOR": {}, "TOPSIS": {}, "SAW": {}, "AHP": {}, "FUZZY_AHP_TOPSIS": {}},
        }

    tickers = [r.ticker for r in results]
    norm_matrix = _build_normalized_matrix(results)
    full_matrix = _build_full_matrix(results)

    saw = _method_saw_scores(norm_matrix)
    ahp_scores = _method_ahp_scores(norm_matrix)
    topsis = _method_topsis_scores(norm_matrix)
    vikor = _method_vikor_scores(norm_matrix)
    hybrid_scores, _, _, _ = _method_hybrid_scores(full_matrix, use_cagr)

    mos_by_ticker: Dict[str, float] = {r.ticker: float(r.mos or 0.0) for r in results}

    def _to_dict(scores: np.ndarray, *, method: str) -> Dict[str, Dict[str, float]]:
        if scores.size == 0:
            return {}

        res: Dict[str, Dict[str, float]] = {}
        for t, s in zip(tickers, scores):
            score = float(s)
            mos = mos_by_ticker.get(t, 0.0)

            if method == "SAW":
                decision = _decision_saw(score, mos)
                res[t] = {"score": score, "decision": decision}
            elif method == "AHP":
                decision = _decision_ahp(score, mos)
                res[t] = {"score": score, "decision": decision}
            elif method == "TOPSIS":
                decision = _decision_topsis(score, mos)
                res[t] = {"score": score, "decision": decision}
            elif method == "VIKOR":
                decision = _decision_vikor(score, mos)
                res[t] = {"score": score, "decision": decision}
            elif method == "FUZZY_AHP_TOPSIS":
                decision, category = _decision_hybrid(score, use_cagr)
                res[t] = {"score": score, "decision": decision, "category": category}

        return res

    cagr_dict: Dict[str, Dict[str, float]] = {
        r.ticker: {
            "net_income": float(r.cagr_net_income),
            "revenue": float(r.cagr_revenue),
            "eps": float(r.cagr_eps),
        }
        for r in results
    }

    return {
        "cagr": cagr_dict,
        "methods": {
            "VIKOR": _to_dict(vikor, method="VIKOR"),
            "TOPSIS": _to_dict(topsis, method="TOPSIS"),
            "SAW": _to_dict(saw, method="SAW"),
            "AHP": _to_dict(ahp_scores, method="AHP"),
            "FUZZY_AHP_TOPSIS": _to_dict(hybrid_scores, method="FUZZY_AHP_TOPSIS"),
        },
    }
