# DECISION MAKING SYSTEM — DOKUMENTASI DESAIN
# File: decision_making.py
# Terakhir diupdate: Maret 2026
# Author: (kamu)
# Reviewer: Claude (Anthropic)

---

## Ringkasan Sistem

Sistem ini adalah mesin keputusan BUY/NO BUY untuk saham IDX menggunakan
pendekatan Multi-Criteria Decision Making (MCDM). Ada 5 metode yang berjalan
paralel, dengan Hybrid FUZZY AHP-TOPSIS sebagai keputusan final.

Pipeline lengkap:
```
yfinance (data.py)
    ↓
CagrResult (dataclass)
    ↓
evaluate_cagr_methods()
    ├── SAW          → growth checker
    ├── AHP          → growth checker (weighted)
    ├── TOPSIS       → relative quality vs peer
    ├── VIKOR        → regret minimization
    └── FUZZY_AHP_TOPSIS → keputusan FINAL (sesuai profil investor)
    ↓
_apply_payout_ratio_safety_check() (data.py)
    ↓
Final Execution: BUY / HOLD / NO BUY
```

---

## Filosofi Investasi yang Dikodekan

Prioritas investor (diputuskan sesi kalibrasi Maret 2026):

    1. Dividen  — passive income rutin
    2. Growth   — bisnis yang tumbuh
    3. Multiple — beli murah, tunggu rerating

Ini bukan sistem untuk growth investor murni. SAW/AHP/TOPSIS/VIKOR
sengaja dibiarkan growth-biased sebagai "alarm" pertumbuhan.
Hybrid adalah satu-satunya metode yang mencerminkan profil di atas.

---

## Input: CagrResult

```python
@dataclass
class CagrResult:
    ticker: str
    cagr_net_income: float   # Net Income CAGR dalam % (misal: 12.5 = 12.5%)
    cagr_revenue:    float   # Revenue CAGR dalam %
    cagr_eps:        float   # EPS CAGR dalam %
    roe:             float   # Return on Equity dalam % (misal: 17.46)
    mos:             float   # Margin of Safety dari Graham Number dalam %
    pbv:             float   # Price to Book Value (misal: 1.62)
    div_yield:       float   # Dividend Yield dalam % (misal: 9.93)
    per:             float   # Price to Earnings Ratio (misal: 9.26)
    down_from_high:  float   # % turun dari High 52 minggu
```

MOS dihitung di data.py dengan rumus Graham Number:
```python
graham = sqrt(22.5 * EPS * BVP_per_share)
mos    = (graham - current_price) / graham * 100
```

---

## Normalisasi Faktor (0..1)

Semua faktor dinormalisasi ke 0..1 sebelum masuk MCDM.
"Lebih besar = lebih baik" untuk semua faktor setelah normalisasi.

| Faktor        | Range input | Normalisasi                          | Catatan                        |
|---------------|-------------|--------------------------------------|--------------------------------|
| EPS CAGR      | % (bebas)   | <=0 → 0, >=25% → 1, linear          | Ceiling 25% cegah outlier      |
| NI CAGR       | % (bebas)   | sama dengan EPS CAGR                 |                                |
| Revenue CAGR  | % (bebas)   | sama dengan EPS CAGR                 |                                |
| ROE           | %           | 0..30% → 0..1, cap di 30%           | ROE >30% dianggap sama         |
| MOS           | %           | 0..80% → 0..1, negatif = 0          | MOS negatif = mahal, skor 0    |
| PBV           | x           | <=1→1, >=4→0, linear di antaranya   | Cost criteria (kecil = bagus)  |
| Div Yield     | %           | 0..10% → 0..1, cap di 10%           | MPMX 12% ter-cap di 1.0        |
| PER           | x           | <=5→1, >=25→0, linear di antaranya  | Cost criteria (kecil = bagus)  |

Catatan MPMX (Maret 2026): Div Yield 12% ter-cap di 1.0 karena ceiling 10%.
Ini by design — ceiling mencegah satu faktor mendominasi seluruh skor.

---

## Matriks yang Digunakan

### norm_matrix (3 kolom) — untuk SAW, AHP, TOPSIS, VIKOR
```
[EPS_CAGR, NI_CAGR, Revenue_CAGR]
```
Hanya faktor growth. Ini yang membuat SAW/AHP/TOPSIS/VIKOR
growth-biased by design.

### full_matrix (8 kolom) — untuk Hybrid FUZZY AHP-TOPSIS
```
[ROE, NI_CAGR, Div_Yield, MOS, PBV_score, PER_score, Rev_CAGR, EPS_CAGR]
```
Mencakup semua pilar: Dividen, Growth, Multiple/Valuasi.

---

## Bobot Hybrid FUZZY AHP-TOPSIS

### Mode WITH CAGR (detailed mode — input CAGR manual)

Digunakan saat data laporan keuangan tersedia (input di halaman detailed).

```
Pilar Dividen (30% total):
  ROE          : 0.18  ← kapasitas membayar dividen secara konsisten
  Div Yield    : 0.12  ← yield aktual yang diterima investor

Pilar Valuasi/Multiple (50% total):
  MOS          : 0.20  ← ruang naik ke fair value (Graham Number)
  PBV Score    : 0.15  ← murah vs book value
  PER Score    : 0.15  ← murah vs earnings

Pilar Growth (20% total):
  NI CAGR      : 0.06  ← dikecilkan, growth bukan prioritas utama
  Revenue CAGR : 0.08  ← top-line growth sebagai sinyal bisnis
  EPS CAGR     : 0.12  ← paling penting di pilar growth (per share)
```

Kenapa EPS CAGR lebih besar dari NI CAGR di pilar Growth?
EPS per share lebih relevan untuk investor individu karena sudah
memperhitungkan dilusi saham. NI bisa naik tapi EPS turun kalau
ada rights issue besar.

Kenapa NI CAGR dikecilkan ke 0.06?
Pelajaran dari MPMX (Maret 2026): EPS CAGR −2% menghukum MPMX terlalu
berat di SAW/AHP/TOPSIS/VIKOR padahal fundamental dan dividennya bagus.
Di Hybrid, growth sengaja diberi porsi kecil supaya value+dividen story
tetap bisa terdeteksi.

### Mode WITHOUT CAGR (dashboard mode — tanpa input CAGR)

Digunakan di dashboard saat CAGR belum diinput.
CAGR dinonaktifkan, beban dialihkan ke faktor fundamental statis.

```
ROE          : 0.20  ← Dividen (total Dividen = 30%)
Div Yield    : 0.10  ← Dividen
MOS          : 0.30  ← Valuasi (dinaikkan karena tidak ada CAGR)
PBV Score    : 0.20  ← Valuasi
PER Score    : 0.20  ← Valuasi
NI CAGR      : 0.00  ← disabled
Revenue CAGR : 0.00  ← disabled
EPS CAGR     : 0.00  ← disabled
```

Mode ini lebih "murah hati" (lebih banyak BUY) karena tanpa penalti CAGR.
Gunakan sebagai filter awal, bukan keputusan final.

---

## Threshold MCDM

### SAW, AHP, TOPSIS, VIKOR

Dikalibrasi dari distribusi skor aktual 39 ticker blue chip IDX
(Maret 2026, data mock realistis + MOS dari Graham Number).

Pendekatan: threshold = persentil ke-70 distribusi aktual.
Artinya: hanya top 30% ticker yang bisa BUY.

| Metode  | Threshold utama | MOS boost (jika MOS > 15%) | Threshold lama | Alasan perubahan              |
|---------|----------------|---------------------------|----------------|-------------------------------|
| SAW     | 0.365          | 0.300                     | 0.560          | Lama terlalu tinggi, p75=0.421|
| AHP     | 0.430          | 0.360                     | 0.600          | Distribusi median=0.186       |
| TOPSIS  | 0.405          | 0.330                     | 0.500          | Pakai Max F1 dari ROC         |
| VIKOR   | 0.450          | 0.370                     | 0.580          | AUC lemah (0.597), konfirmasi |

MOS boost: kalau MOS > 15% (undervalued), threshold diturunkan sedikit.
Logika: saham yang undervalued layak diberi kelonggaran meski skor growth-nya pas-pasan.

VIKOR catatan: AUC 0.597 (paling lemah dari 4 metode). Gunakan sebagai
konfirmasi, bukan penentu utama. Kalau 3 metode lain bilang NO BUY tapi
VIKOR BUY, tetap NO BUY.

### Hybrid FUZZY AHP-TOPSIS

Threshold dikalibrasi dari distribusi skor aktual 39 ticker.
Distribusi Hybrid: min=0.209, median=0.415, max=0.766.

```
Mode WITH CAGR:
  Recommended to Buy : score > 0.52
  Buy                : score >= 0.44
  Buy with Risk      : score >= 0.34
  Don't Buy          : score < 0.34

Mode WITHOUT CAGR (dashboard):
  Recommended to Buy : score > 0.58  ← lebih ketat karena tanpa info CAGR
  Buy                : score >= 0.50
  Buy with Risk      : score >= 0.38
  Don't Buy          : score < 0.38
```

Kenapa WITHOUT CAGR threshold-nya lebih tinggi?
Tanpa CAGR, skor cenderung lebih tinggi (tidak ada penalti growth negatif).
Threshold dinaikkan supaya standar seleksinya tetap konsisten.

---

## Payout Ratio Safety Check (data.py)

Ditambahkan Maret 2026 setelah observasi BBRI, MPMX, PTBA.

### Formula Payout Penalty

```python
payout_penalty = (
    1.0   if payout <= 70                              # aman
    0.85  if payout <= 85                              # sedikit elevated
    0.75  if payout <= 95 and div_growth > 0           # tinggi tapi tumbuh
    0.50  if payout <= 95                              # tinggi, tidak tumbuh
    0.60  if payout > 95 and div_growth > 0            # sangat tinggi tapi tumbuh
    0.20  if payout > 95 and div_growth <= 0           # berbahaya
)
```

### Hasil per kasus nyata (Maret 2026)

| Ticker | Payout | Div Growth | Penalty | Final    | Alasan                              |
|--------|--------|------------|---------|----------|-------------------------------------|
| BBCA   | 65.31% | 22.49%     | -       | NO BUY   | Base signal sudah NO BUY (MOS -38%) |
| BBRI   | 91.86% | 17.70%     | 0.75    | BUY      | Elevated tapi div tumbuh kencang    |
| MPMX   | 95.24% | 5.92%      | 0.60    | BUY      | Sangat tinggi tapi div masih tumbuh |
| PTBA   | 117%   | 0.36%      | 0.60    | BUY      | >100% tapi div masih tumbuh         |

PTBA catatan: Payout >100% berarti bayar dividen lebih dari profit tahun itu.
Bisa dari retained earnings — perlu cek manual apakah ini one-time atau tren.

### Threshold eksekusi final

```
penalty >= 0.55 → Final Execution: BUY
penalty <  0.55 → Final Execution: HOLD
base signal NO BUY → Final Execution: NO BUY (penalty tidak dihitung)
```

### Bug fix: normalisasi payout ratio (Maret 2026)

yfinance kadang kirim payout ratio dalam format berbeda:
- 0.6531 = 65.31% (format desimal, 0 < val <= 1)
- 1.17   = 117%   (format desimal > 1, harus dikali 100)
- 91.86  = 91.86% (sudah dalam persen)

Fix yang diimplementasikan di `_normalize_percent_value`:
```python
if 0 < val <= 1:    return val * 100   # 0.6531 → 65.31
if 1 < val <= 20:   return val * 100   # 1.17   → 117.0
return val                              # 91.86  → 91.86
```

---

## Cara Baca Hasil (Panduan Pengguna)

```
Base Signal (Hybrid)    : keputusan WITHOUT CAGR (fundamental only)
Final Signal (Detailed) : keputusan WITH CAGR (setelah input growth)
Final Execution         : BUY/HOLD/NO BUY setelah payout safety check

Base Score  : skor Hybrid mode dashboard (0..1)
Final Score : skor Hybrid mode detailed (0..1)
```

Interpretasi per metode:
```
SAW    → "Apakah bisnis ini tumbuh?" (growth checker)
AHP    → "Apakah bisnis ini tumbuh?" dengan bobot AHP
TOPSIS → "Seberapa baik vs peer dalam universe yang sama?"
VIKOR  → "Seberapa besar risiko penyesalan kalau beli?"
HYBRID → Keputusan final sesuai profil: Dividen > Growth > Multiple
```

Kapan perlu khawatir meski Hybrid bilang BUY:
1. Payout ratio > 95% DAN div growth <= 0 (dividend trap)
2. Revenue CAGR negatif (bisnis menyusut, bukan hanya EPS flat)
3. Semua 4 metode skor di bawah 0.10 (fundamental sangat lemah)
4. MOS negatif besar (> -30%) — harga sudah sangat premium

---

## Kalibrasi Ulang

Threshold harus dikalibrasi ulang setiap kuartal karena:
- Universe ticker berubah
- Kondisi pasar bergeser (bull/bear mempengaruhi distribusi skor)
- Tambahan data historis memperkuat sinyal ROC

Tool kalibrasi: `threshold_calibrator_v4.py`
Metode: ROC curve + Youden J index
Minimum sample: 30 ticker untuk AUC yang reliable

Hasil kalibrasi terakhir (Maret 2026):
```
SAW    AUC=0.749  → threshold 0.365 (dari ROC, 40 ticker IDX)
AHP    AUC=0.632  → threshold 0.430
TOPSIS AUC=0.671  → threshold 0.405 (Max F1)
VIKOR  AUC=0.597  → threshold 0.450 (lemah, gunakan sebagai konfirmasi)
```

---

## Known Limitations

1. Graham Number sebagai basis MOS — tidak cocok untuk semua sektor.
   Sektor teknologi (GOTO, EMTK) dan sektor dengan intangible asset tinggi
   sering dapat MOS negatif besar bukan karena mahal, tapi karena BVP-nya kecil.

2. CAGR ceiling 25% — ticker dengan growth ekstrem (GJTL +145%, ADHI +66%)
   di-cap. Ini by design untuk cegah outlier, tapi bisa miss genuinely
   high-growth companies.

3. Div Yield ceiling 10% — MPMX (12%) ter-cap di 1.0. Dividend investor
   yang butuh diferensiasi di atas 10% perlu naikkan ceiling ini.

4. MOS dari Graham Number tidak mempertimbangkan hutang. Saham dengan
   debt-to-equity tinggi bisa dapat MOS bagus padahal berisiko.
   Tambahkan D/E ratio sebagai filter tambahan jika perlu.

5. Single-ticker edge case — TOPSIS dan VIKOR fallback ke mode absolut
   kalau hanya ada 1 ticker. Skor tetap keluar tapi tidak bisa dibandingkan
   relatif. Pastikan selalu input minimal 2 ticker.

6. yfinance IDX tidak selalu reliable — beberapa ticker (UNVR, HMSP, PGAS)
   sering HTTP 500. Data yang kosong di-default ke 0 yang bisa menekan skor.

---

## Changelog

### Maret 2026 (sesi kalibrasi pertama)
- Threshold SAW: 0.560 → 0.365 (dari distribusi aktual 39 ticker)
- Threshold AHP: 0.600 → 0.430
- Threshold TOPSIS: 0.500 → 0.405 (Max F1 dari ROC)
- Threshold VIKOR: 0.580 → 0.450
- Hybrid WITH CAGR threshold: (0.62, 0.52, 0.40) → (0.52, 0.44, 0.34)
- Hybrid WITHOUT CAGR threshold: (0.58, 0.48, 0.36) → (0.58, 0.50, 0.38)
- Tambah payout ratio safety check dengan dividend growth modifier
- Fix bug normalisasi payout ratio yfinance (1.17 → 117%, bukan 1.17%)
- Tambah Dividend Growth dari histori 5 tahun sebagai fallback
- Bobot Hybrid diubah: Dividen 30%, Growth 20%, Valuasi 50%
  (sebelumnya Growth ~39% — terlalu tinggi untuk profil dividend investor)
