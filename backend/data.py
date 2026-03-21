import yfinance as yf
import pandas as pd
import numpy as np

from backend.decision_making import CagrResult, evaluate_cagr_methods


def _decision_engine(current_price, mos, roe, pbv, div_yield, down_from_high):
    """Mesin keputusan untuk label diskon & dividen.

    VIKOR untuk keputusan BUY/NO BUY akan diterapkan
    di tingkat DataFrame (lihat _apply_vikor_buy_decision).

    Output:
    - buy_decision: placeholder (akan dioverride VIKOR jika memungkinkan)
    - discount_label: "Diskon Tinggi" / dst
    - dividend_label: "Dividen Tinggi" / dst
    """

    mos = float(mos or 0)
    roe = float(roe or 0)
    pbv = float(pbv or 0)
    div_yield = float(div_yield or 0) * 100 if 0 < float(div_yield or 0) < 1 else float(div_yield or 0 or 0)
    down_from_high = float(down_from_high or 0)

    # 1) Diskon berdasarkan seberapa jauh dari HIGH 52
    if down_from_high >= 40:
        discount_label = "Diskon Sangat Tinggi"
    elif down_from_high >= 30:
        discount_label = "Diskon Tinggi"
    elif down_from_high >= 20:
        discount_label = "Diskon Sedang"
    elif down_from_high >= 10:
        discount_label = "Diskon Oke"
    elif down_from_high >= 5:
        discount_label = "Diskon Kecil"
    else:
        discount_label = "Tidak Diskon"

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

    return buy_decision, discount_label, dividend_label


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

    Menggunakan mesin yang sama dengan detailed CAGR (decision_making.py),
    tetapi dengan CAGR = 0 dan hanya memanfaatkan faktor fundamental:
    ROE, MOS, PBV, Dividend Yield, Down From High.
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

    results: list[CagrResult] = []

    for _, row in df.iterrows():
        ticker = str(row.get("Ticker") or row.get("Name") or "-")

        roe = float(row.get("ROE (%)") or 0.0)
        mos = float(row.get("MOS (%)") or 0.0)
        pbv = float(row.get("PBV") or 0.0)
        div_yield = float(row.get("Dividend Yield (%)") or 0.0)
        per = float(row.get("PER NOW") or 0.0)

        results.append(
            CagrResult(
                ticker=ticker,
                cagr_net_income=0.0,
                cagr_revenue=0.0,
                cagr_eps=0.0,
                roe=roe,
                mos=mos,
                pbv=pbv,
                div_yield=div_yield,
                per=per,
                down_from_high=0.0,
            )
        )

    # Mode dashboard: belum ada input CAGR user, jadi kalibrasi hybrid
    # memakai fundamental-only agar skor tidak tertekan oleh kolom CAGR = 0.
    eval_result = evaluate_cagr_methods(results, use_cagr=False)
    methods = eval_result.get("methods", {})
    hybrid = methods.get("FUZZY_AHP_TOPSIS", {})

    for idx, row in df.iterrows():
        ticker = str(row.get("Ticker") or row.get("Name") or "-")
        info = hybrid.get(ticker)
        if not info:
            continue
        decision = info.get("decision")
        score = info.get("score")
        category = info.get("category")

        if decision:
            df.at[idx, "Decision Buy"] = decision
        if score is not None:
            df.at[idx, "Hybrid Score"] = float(score)
        if category:
            df.at[idx, "Hybrid Category"] = str(category)

    return df


def get_stock_data(ticker_list):
    all_data = []
    
    for symbol in ticker_list:
        print(f"Mengambil data untuk: {symbol}...")
        stock = yf.Ticker(symbol)

        # Beberapa field dari yfinance bisa None, jadi kita normalisasi dulu
        try:
            info = stock.get_info()
        except AttributeError:
            info = getattr(stock, "info", {}) or {}
        
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

        
        # 3. Perhitungan Kustom (Kalkulasi Otomatis)
        # Rumus Graham Number: sqrt(22.5 * EPS * BVP)
        if eps > 0 and bvp_per_s > 0:
            graham = np.sqrt(22.5 * eps * bvp_per_s)
            mos = ((graham - current_price) / graham) * 100
        else:
            graham = 0
            mos = 0
            
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
        buy_decision, discount_label, dividend_label = _decision_engine(
            current_price=current_price,
            mos=mos,
            roe=roe,
            pbv=pbv,
            div_yield=div_yield,
            down_from_high=down_from_high,
        )

        # Menyusun data ke dalam dictionary
        data = {
            'Ticker': symbol,
            'Name': info.get('shortName', symbol),
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
            'Dividend Yield (%)': div_yield,
            'Decision Buy': buy_decision,
            'Decision Discount': discount_label,
            'Decision Dividend': dividend_label,
            
        }
        all_data.append(data)
    
    df = pd.DataFrame(all_data)

    # Terapkan Hybrid FUZZY AHP-TOPSIS untuk keputusan BUY/NO BUY
    df = _apply_fuzzy_ahp_topsis_buy_decision(df)

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