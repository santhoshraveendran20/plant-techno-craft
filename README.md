<p align="center"><img src="frontend/public/brand/logo.webp" alt="Plant Technocrat — Growing Green Futures" width="220"></p>

# Plant Technocrat — UPI Payment Tracking & Business Analytics

The billing counter app for **Plant Technocrat** (*Growing Green Futures*). It **bills customers for plants, pots,
seeds, soil and tools, takes UPI through a dynamic QR per bill, confirms automatically who paid how much,
tracks dues, manages nursery stock, and shows sales analytics**.
Built from the BRD *"UPI Payment Tracking & Business Analytics App"* (FR-01 … FR-38).

| Layer     | Technology |
|-----------|------------|
| Frontend  | React 18 + Vite, Tailwind CSS 3, **shadcn/ui** (Radix UI), **Chart.js** (react-chartjs-2), lucide icons |
| Backend   | **FastAPI**, SQLAlchemy 2, Pydantic 2, JWT auth, bcrypt |
| Database  | **MySQL 8** (PyMySQL driver) |
| Payments  | Gateway adapter: built-in **mock gateway** (dynamic QR, signed webhooks, status polling, T+1 settlement files) and a **Razorpay** adapter |
| Extras    | Barcode scanning (USB + phone camera), barcode labels (JsBarcode), thermal receipts (58/80 mm), Excel / PDF exports (openpyxl, ReportLab) |

**Phone, tablet and desktop.** Every screen is tested from 360 px phones through tablets (768–1024 px) to desktop:
* **Phones:** lists turn into cards, Billing has a bottom checkout bar, and secondary actions move into a *More* menu.
* **Tablets:** Billing shows the cart and the bill summary side by side, and less important table columns are hidden so nothing scrolls sideways.
* **Desktop:** the full tables are shown.

**Branding.** The Plant Technocrat logo appears on the sign-in page, in the menu and mobile header, on the
customer display, the customer payment page, printed receipts (black and white for thermal printers), PDF exports
and as the browser / home-screen icon. The theme uses the logo's forest green, leaf green and gold.
* Shop name, tagline, address, phone, GSTIN, **UPI ID** and receipt footer are edited under **Settings**.
  The UPI ID starts as the placeholder `planttechnocrat@demo` — **replace it with the shop's real UPI ID before going live.**
* Logo files live in `frontend/public/brand/` (`logo.webp` full logo, `mark.webp` emblem, favicons) and
  `backend/app/assets/mark.png` (PDF exports). Replace them with files of the same names to update the logo.

**Charts (Chart.js).** All charts come from one shared module, `frontend/src/components/charts.jsx`, so colours,
tooltips and phone / tablet sizing match everywhere. You'll find them on these pages:

| Page | Charts |
|------|--------|
| Dashboard | Sales trend vs previous period, sales by payment mode, top products, peak hours, dues ageing |
| Payments | Money collected per day (UPI vs cash) |
| Dues & reminders | Dues by age, largest dues |
| Reports | Stock value by category, revenue vs gross margin, fast/slow/dead mix, money tied up in stock, days of stock left |
| Customer | Purchases vs payments by month |
| Product | Stock level over time, units sold per week |
| Supplier | Purchases vs payments by month |
| Reconciliation | Last 14 days of app UPI vs gateway vs bank credit (tap a day to open it) |

---

## 1. Requirements

| Tool | Version |
|------|---------|
| Python | **3.11 – 3.14** (tested on 3.11, 3.13, 3.14) |
| Node.js | **18.18+** (20 or 22 LTS recommended) |
| MySQL | **8.0+** |

## 2. Set up MySQL (one time)

Open the MySQL shell (`mysql -u root -p`) and run:

```sql
CREATE DATABASE upi_tracker CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'upi'@'localhost' IDENTIFIED BY 'upi_pass123';
GRANT ALL PRIVILEGES ON upi_tracker.* TO 'upi'@'localhost';
FLUSH PRIVILEGES;
```

(You can use any user/password — just put the same values in `backend/.env`. Tables are created automatically.)

## 3. Run the backend (FastAPI)

**Windows (PowerShell)**

```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env          # then edit DATABASE_URL if your MySQL user/password differ
python -m app.seed              # optional: loads 90 days of demo data
uvicorn app.main:app --reload --port 8000
```

**macOS / Linux**

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # then edit DATABASE_URL if needed
python -m app.seed              # optional demo data
uvicorn app.main:app --reload --port 8000
```

* API docs (Swagger): <http://localhost:8000/docs>
* `python -m app.seed --reset` wipes all tables and reloads the demo data.
* Without the seed, the first start creates only the owner login (`owner` / `owner123`).

## 4. Run the frontend (React)

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. Vite forwards `/api` calls to the backend on port 8000.

**Demo logins** (after `python -m app.seed`):

| Role | Username | Password | Sees |
|------|----------|----------|------|
| Owner / Admin | `owner` | `owner123` | Everything: dashboard, money totals, exports, settings, staff, approvals |
| Cashier / Staff | `cashier` | `cashier123` | Billing, scanning, QR, cash, credit sales, customer dues, stock requests |

Change the passwords from the user menu (top right) after the first login.

## 5. Run everything from one server (production style)

```bash
cd frontend && npm run build          # creates frontend/dist
cd ../backend && uvicorn app.main:app --host 0.0.0.0 --port 8000
```

FastAPI serves the built app and the API together on <http://localhost:8000>. When you use port 8000,
set `PUBLIC_APP_URL=http://localhost:8000` in `backend/.env` so customer payment links point to the right place.
Put it behind HTTPS (Nginx / Caddy) in production — the phone camera scanner and the gateway webhooks need HTTPS.

---

## 6. Try the UPI flow (test gateway)

`PAYMENT_GATEWAY=mock` (the default) behaves like a real aggregator, so you can demo the whole flow without
a merchant account:

1. Sign in as **cashier** → **Billing**. Scan or type a barcode (e.g. `8901558126575`, Money Plant 6in pot) and press Enter, or search by name (e.g. "rose").
2. Pick a customer (or keep walk-in) → **Checkout** → **UPI** → **Show UPI QR**.
   The QR is a real `upi://pay` dynamic QR for the exact amount, with the bill ID as its reference, and it expires after 15 minutes.
3. Open **Customer display** (sidebar) on a second screen — it shows the same QR to the customer.
4. In the QR panel's *Test mode* box, simulate the customer's UPI app:
   * **Pays** – the gateway sends a signed webhook → bill turns **Paid** in about a second, with a chime and an on-screen alert.
   * **Pays less** – amount mismatch: the bill stays open and you collect the balance by cash, credit or a new QR.
   * **Payment fails** – shows the failure; press **New QR** to retry.
   * **Webhook lost** – the webhook is dropped; the 3-second status poll picks the payment up anyway.
5. Check **Payments** (UTR, payer UPI ID, match status), the **customer ledger**, **Dues & reminders** and the **Dashboard**.
6. **Reconciliation** → pick a date → **Fetch settlement report** to match app vs gateway vs bank credit and import
   any payment the app missed. The demo data contains one deliberately missed webhook from two days ago.

## 7. Going live with Razorpay

1. Open a Razorpay merchant account (KYC) and enable UPI QR codes.
2. In `backend/.env`: `PAYMENT_GATEWAY=razorpay`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.
3. In the Razorpay dashboard, add a webhook to `https://<your-domain>/api/upi/webhook/razorpay` for the events
   `qr_code.credited` and `payment.failed`, using the same secret.
4. Set `PUBLIC_APP_URL` to your HTTPS domain.

The adapter (`backend/app/services/gateway/razorpay.py`) follows Razorpay's documented QR Codes,
webhook-signature and settlement-recon APIs, but it **could not be tested against live Razorpay keys** while
building this project. Try it in Razorpay **test mode** before taking real money. Other providers (Cashfree,
PhonePe Business, a bank API) plug in by adding one class that implements `PaymentGateway` in `services/gateway/base.py`.

---

## 8. BRD coverage

| ID | Requirement | Where |
|----|-------------|-------|
| FR-01 | Products with name, category, price, barcode, stock | Products |
| FR-02 | Scan with phone camera or USB scanner | Billing (scan box + Camera), Stock-in, Stock count |
| FR-03 | Print barcode labels for items without one | Products → *Labels for items without barcode* / select → *Print labels* |
| FR-04/05 | Customers keyed by mobile; find by mobile/name; walk-in bills | Customer picker in Billing, Customers |
| FR-06 | Bill with items, qty, discount; save as draft | Billing (*Save as draft*, F4; *Drafts*) |
| FR-07 | UPI, cash, credit or a split | Checkout dialog |
| FR-08 | Send bill on WhatsApp / SMS; thermal receipt | Bill page, checkout → *Print receipt* (58 / 80 mm) |
| FR-09/10 | Dynamic QR for the exact amount with bill ID; counter + customer display; 15-min expiry | QR panel, `/display` |
| FR-11 | Webhook marks bill Paid within seconds with sound + alert | `/api/upi/webhook/{gateway}` + 3 s polling |
| FR-12 | Store UTR, payer VPA, payer name, amount, time | Payments |
| FR-13 | Failed / pending / mismatch handling, retry or new QR | QR panel, *Payments → Needs review* |
| FR-14 | UPI payment link for remote payment | Customer → *Payment link* (public page `/pay/<token>`) |
| FR-15/16 | Ledger with running balance; part / advance payments settle the oldest bill first | Customer → Ledger |
| FR-17 | Auto-link payments from a known UPI ID | Customer *Known UPI IDs*; also learned automatically |
| FR-18/19 | Dues list (amount, oldest due, days overdue, sort/filter); one-tap WhatsApp / SMS reminder with pay link | Dues & reminders |
| FR-20 | Daily match: app vs gateway settlement vs bank credit; gaps flagged | Reconciliation (+ webhook log with retry) |
| FR-21–24 | Today's sales/collected/due by mode; trends vs previous period; top products/customers; peak hours; average bill; dues ageing; low-stock and slow-moving alerts | Dashboard (Chart.js) |
| FR-25 | Staff logins with roles; audit log of edits, discounts, deletions | Staff, Audit log |
| FR-26 | Export bills, payments, dues (+ stock, sales) to Excel / PDF | Export buttons (owner) |
| FR-27/28 | Stock-in from supplier invoices; every paid/credit bill reduces stock | Stock-in; stock movements |
| FR-29 | Sales returns put stock back and refund or credit the ledger | Bill → *Return items* |
| FR-30 | Adjustments (damage, loss, wastage, correction) with reason, user, owner approval | Adjustments |
| FR-31 | Stock movement history per product | Product page, Stock movements |
| FR-32/33 | Reorder level; low/out-of-stock alerts; warn or block zero-stock sales | Dashboard, alert bell, Settings |
| FR-34 | Suppliers with products supplied, purchase history, amount payable | Suppliers |
| FR-35 | Physical stock count → differences posted as adjustments | Stock count |
| FR-36 | Stock value (cost & selling), sales qty, gross margin, fast / slow / dead stock | Reports |
| FR-37 | Batch & expiry with near-expiry alerts | Stock-in batch/expiry, Reports → Expiry, alert bell |
| FR-38 | Suggested reorder quantity from last 30 days' sales | Reports → Reorder |

**Non-functional:** webhooks are signature-verified and idempotent (the same UTR / gateway payment id is never
counted twice, enforced by unique keys); a webhook that fails processing is kept for **retry**, and status
polling covers late webhooks. Gateway keys stay server-side. Access is role-based. WhatsApp/SMS are blocked
without recorded customer consent (DPDP Act). Drafts are saved on the device while offline and sync when back
online. Completed bills and payments are never deleted (returns and refunds reverse them instead).
The layout is responsive for phone, tablet and desktop.

**Not built in v1:**
* WhatsApp / SMS open as ready-to-send `wa.me` / `sms:` links on the counter device; there is no WhatsApp Business API or SMS gateway integration.
* No GST invoicing. The BRD lists it as an open question, and GST returns are out of scope.
* No automated encrypted backups. Schedule one with your OS, e.g.
  `mysqldump -u upi -p upi_tracker | gzip > backup.sql.gz`, then encrypt it, e.g. with `gpg -c`.

---

## 9. Project structure

```
backend/
  app/
    main.py              FastAPI app, startup (creates DB/tables + owner), serves frontend/dist
    models.py            SQLAlchemy models (bills, payments, ledger, stock movements, settlements…)
    routers/             REST endpoints (auth, products, customers, bills, upi, payments,
                         inventory, dashboard/reports, recon, exports, audit/notifications)
    services/
      billing.py         checkout, complete bill, cancel, returns
      ledger.py          customer ledger + oldest-first settlement
      upi.py             dynamic QR, webhook processing, polling, VPA auto-link
      recon.py           settlement fetch, matching, gap report
      analytics.py       dashboard + reports
      gateway/           PaymentGateway interface, mock gateway, Razorpay adapter
    seed.py              90 days of plant-nursery demo data (indoor, flowering, succulents, fruit & herb
                         plants, seeds, pots, soil & fertilizers, garden tools)
    assets/mark.png      logo used in PDF exports
  tests/                 end-to-end API tests (pytest + MySQL)
frontend/
  src/
    components/ui/       shadcn/ui components
    components/charts.jsx      every Chart.js chart (shared palette, tooltips, phone/tablet sizing)
    components/data-table.jsx  responsive list: cards on phones, trimmed columns on tablets, full table on desktop
    components/brand.jsx       Plant Technocrat logo / emblem components
    components/          QR panel, barcode scanner, layout, shared widgets
  public/brand/          logo, emblem and favicons
    pages/               one file per screen
```

## 10. Tests

The backend tests run every main flow against a real MySQL test database: billing, UPI webhooks and
idempotency, mismatch, failure and retry, lost webhook with polling, oldest-first settlement, returns,
write-off, stock-in, adjustments, stock count, dashboard, exports and reconciliation.

```bash
# one time, as MySQL root:
#   CREATE DATABASE upi_tracker_test; GRANT ALL PRIVILEGES ON upi_tracker_test.* TO 'upi'@'localhost';
cd backend
python -m pytest -q          # uses TEST_DATABASE_URL, default mysql+pymysql://upi:upi_pass123@localhost:3306/upi_tracker_test
```

## 11. Troubleshooting

| Problem | Fix |
|---------|-----|
| `Database is not reachable` / `Access denied for user` | Check MySQL is running and that `DATABASE_URL` in `backend/.env` has the right user, password and port. |
| `'cryptography' package is required` | Run `pip install -r requirements.txt` inside the activated virtual environment. |
| Port 8000 or 5173 already in use | `uvicorn app.main:app --port 8001` and change the proxy target in `frontend/vite.config.js`. |
| Camera scanner says it needs HTTPS | Browsers allow the camera only on `https://` or `localhost`. USB scanners always work. |
| Payment links open the wrong host | Set `PUBLIC_APP_URL` in `backend/.env` to the address customers can reach. |
| No sound on the customer display | Tap *Tap to enable sound* once; browsers block audio until you interact with the page. |
