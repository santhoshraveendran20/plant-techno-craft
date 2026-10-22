"""End-to-end API flows against a real MySQL database (see conftest.py)."""

from datetime import date

import pytest

S = {}  # shared state between the ordered tests below


def ok(r, code=200):
    assert r.status_code == code, f"{r.status_code}: {r.text}"
    return r.json()


def stock_of(client, h, pid):
    return ok(client.get(f"/api/products/{pid}", headers=h))["stock_qty"]


def customer(client, h, cid):
    return ok(client.get(f"/api/customers/{cid}", headers=h))


def new_bill(client, h, items, customer_id=None, discount=0):
    return ok(client.post("/api/bills", headers=h, json={
        "customer_id": customer_id, "discount": discount,
        "items": [{"product_id": pid, "qty": q} for pid, q in items],
    }))


def test_auth_and_roles(client, owner, cashier):
    assert ok(client.get("/api/auth/me", headers=owner))["role"] == "owner"
    assert ok(client.get("/api/auth/me", headers=cashier))["role"] == "cashier"
    assert client.post("/api/auth/login", json={"username": "owner", "password": "bad"}).status_code == 401
    assert client.get("/api/dashboard/summary", headers=cashier).status_code == 403
    assert client.get("/api/products").status_code == 401


def test_catalogue(client, owner, cashier):
    cat = ok(client.post("/api/categories", headers=owner, json={"name": "Groceries"}))
    rice = ok(client.post("/api/products", headers=owner, json={
        "name": "Rice 1kg", "category_id": cat["id"], "barcode": "8901234567890", "unit": "pcs",
        "cost_price": 50, "selling_price": 60, "stock_qty": 100, "reorder_level": 10}))
    oil = ok(client.post("/api/products", headers=owner, json={
        "name": "Oil 1L", "category_id": cat["id"], "cost_price": 120, "selling_price": 150,
        "stock_qty": 3, "reorder_level": 5, "track_expiry": True}))
    assert rice["stock_qty"] == 100 and oil["stock_status"] == "low"
    assert client.post("/api/products", headers=owner, json={
        "name": "Dup", "barcode": "8901234567890", "selling_price": 1}).status_code == 400
    assert client.post("/api/products", headers=cashier, json={"name": "X", "selling_price": 1}).status_code == 403
    found = ok(client.get("/api/products/barcode/8901234567890", headers=cashier))
    assert found["id"] == rice["id"] and "cost_price" not in found
    gen = ok(client.post(f"/api/products/{oil['id']}/generate-barcode", headers=owner))
    assert len(gen["barcode"]) == 13 and gen["barcode"].startswith("2")
    moves = ok(client.get(f"/api/products/{rice['id']}/movements", headers=owner))
    assert moves[0]["movement_type"] == "opening" and moves[0]["balance_after"] == 100
    S.update(rice=rice["id"], oil=oil["id"])


def test_customers(client, owner, cashier):
    c = ok(client.post("/api/customers", headers=owner, json={
        "name": "Ravi Kumar", "mobile": "+91 98765 43210", "opening_balance": 500,
        "whatsapp_consent": True, "vpas": ["ravi@okicici"]}))
    assert c["mobile"] == "9876543210" and c["balance"] == 500 and c["vpas"][0]["vpa"] == "ravi@okicici"
    assert client.post("/api/customers", headers=cashier, json={"name": "Dup", "mobile": "9876543210"}).status_code == 400
    c2 = ok(client.post("/api/customers", headers=cashier, json={"name": "Meena", "mobile": "9123456780"}))
    assert client.post("/api/customers", headers=cashier, json={
        "name": "Ob", "mobile": "9000000001", "opening_balance": 10}).status_code == 403
    S.update(ravi=c["id"], meena=c2["id"])


def test_cash_bill_reduces_stock(client, cashier):
    bill = new_bill(client, cashier, [(S["rice"], 2), (S["rice"], 1)])
    assert bill["status"] == "draft" and len(bill["items"]) == 1 and bill["total"] == 180
    res = ok(client.post(f"/api/bills/{bill['id']}/checkout", headers=cashier, json={"cash_amount": 180}))
    assert res["bill"]["status"] == "paid" and res["upi_request"] is None
    assert res["bill"]["bill_no"].startswith("B")
    assert stock_of(client, cashier, S["rice"]) == 97


def test_walkin_credit_blocked_and_discount_limit(client, cashier, owner):
    bill = new_bill(client, cashier, [(S["rice"], 1)])
    r = client.post(f"/api/bills/{bill['id']}/checkout", headers=cashier, json={"cash_amount": 0})
    assert r.status_code == 400 and "Walk-in" in r.json()["detail"]
    r = client.put(f"/api/bills/{bill['id']}", headers=cashier, json={
        "items": [{"product_id": S["rice"], "qty": 1}], "discount": 30})
    assert r.status_code == 403
    ok(client.put(f"/api/bills/{bill['id']}", headers=owner, json={
        "items": [{"product_id": S["rice"], "qty": 1}], "discount": 30}))
    res = ok(client.post(f"/api/bills/{bill['id']}/checkout", headers=owner, json={"cash_amount": 30}))
    assert res["bill"]["total"] == 30 and res["bill"]["status"] == "paid"
    draft = new_bill(client, cashier, [(S["rice"], 1)])
    assert ok(client.delete(f"/api/bills/{draft['id']}", headers=cashier))["result"] == "deleted"


def test_credit_bill_and_ledger(client, cashier):
    bill = new_bill(client, cashier, [(S["rice"], 5)], customer_id=S["ravi"])
    res = ok(client.post(f"/api/bills/{bill['id']}/checkout", headers=cashier, json={}))
    assert res["bill"]["status"] == "credit" and res["bill"]["due_amount"] == 300
    assert customer(client, cashier, S["ravi"])["balance"] == 800
    S["ravi_credit_bill"] = bill["id"]


def test_upi_bill_webhook_and_idempotency(client, cashier, owner):
    before = stock_of(client, cashier, S["rice"])
    bill = new_bill(client, cashier, [(S["rice"], 2)])
    res = ok(client.post(f"/api/bills/{bill['id']}/checkout", headers=cashier, json={"upi_amount": 120}))
    req = res["upi_request"]
    assert res["bill"]["status"] == "pending" and req["status"] == "active"
    assert req["payload"].startswith("upi://pay?") and "am=120.00" in req["payload"]
    assert req["seconds_left"] > 800  # 15 minute expiry
    assert stock_of(client, cashier, S["rice"]) == before  # stock moves only when paid

    sim = ok(client.post(f"/api/upi/requests/{req['id']}/simulate", headers=cashier, json={
        "outcome": "success", "payer_vpa": "walkin@ybl", "payer_name": "A Buyer"}))
    assert sim["simulation"]["webhook"]["status"] == "processed"
    status = sim["request"]
    assert status["status"] == "paid" and status["bill"]["status"] == "paid"
    assert stock_of(client, cashier, S["rice"]) == before - 2

    detail = ok(client.get(f"/api/bills/{bill['id']}", headers=cashier))
    upi_payments = [p for p in detail["payments"] if p["mode"] == "upi"]
    assert len(upi_payments) == 1 and upi_payments[0]["utr"] and upi_payments[0]["payer_vpa"] == "walkin@ybl"

    # Same webhook delivered again + a status poll: still exactly one payment
    from app.database import SessionLocal
    from app.models import MockGatewayTxn
    from app.services.gateway import get_gateway

    gw = get_gateway("mock")
    with SessionLocal() as db:
        txn = db.query(MockGatewayTxn).filter_by(gateway_payment_id=sim["simulation"]["gateway_payment_id"]).one()
        raw = gw.webhook_body(txn)
    sig = gw.sign(raw)
    r = client.post("/api/upi/webhook/mock", content=raw, headers={"X-Mock-Signature": sig, "Content-Type": "application/json"})
    assert r.status_code == 200 and r.json()["status"] == "processed"
    ok(client.get(f"/api/upi/requests/{req['id']}", headers=cashier))
    detail = ok(client.get(f"/api/bills/{bill['id']}", headers=cashier))
    assert len([p for p in detail["payments"] if p["mode"] == "upi"]) == 1
    assert detail["paid_amount"] == 120

    bad = client.post("/api/upi/webhook/mock", content=raw, headers={"X-Mock-Signature": "nope"})
    assert bad.status_code == 401


def test_split_payment_with_mismatch(client, cashier):
    bill = new_bill(client, cashier, [(S["rice"], 3)], customer_id=S["meena"])  # 180
    res = ok(client.post(f"/api/bills/{bill['id']}/checkout", headers=cashier, json={"cash_amount": 30, "upi_amount": 100}))
    req = res["upi_request"]
    sim = ok(client.post(f"/api/upi/requests/{req['id']}/simulate", headers=cashier, json={"amount": 60, "payer_vpa": "meena@paytm"}))
    assert sim["request"]["status"] == "partially_paid" and sim["request"]["bill"]["status"] == "pending"
    # customer pays the rest by cash; remaining 50 stays on credit
    res = ok(client.post(f"/api/bills/{bill['id']}/checkout", headers=cashier, json={"cash_amount": 40}))
    assert res["bill"]["status"] == "part_paid" and res["bill"]["paid_amount"] == 130 and res["bill"]["due_amount"] == 50
    c = customer(client, cashier, S["meena"])
    assert c["balance"] == 50 and any(v["vpa"] == "meena@paytm" for v in c["vpas"])  # VPA remembered


def test_failed_then_new_qr_and_lost_webhook(client, cashier):
    bill = new_bill(client, cashier, [(S["rice"], 1)])
    req = ok(client.post(f"/api/bills/{bill['id']}/checkout", headers=cashier, json={"upi_amount": 60}))["upi_request"]
    sim = ok(client.post(f"/api/upi/requests/{req['id']}/simulate", headers=cashier, json={"outcome": "failed"}))
    assert sim["request"]["status"] == "failed"
    req2 = ok(client.post(f"/api/bills/{bill['id']}/upi-qr", headers=cashier))
    assert req2["amount"] == 60 and req2["id"] != req["id"]
    assert ok(client.get(f"/api/upi/requests/{req['id']}", headers=cashier))["status"] == "cancelled"
    # webhook lost: only the status poll can find it
    sim = ok(client.post(f"/api/upi/requests/{req2['id']}/simulate", headers=cashier, json={"deliver_webhook": False}))
    assert sim["request"]["status"] == "active"
    polled = ok(client.get(f"/api/upi/requests/{req2['id']}", headers=cashier))
    assert polled["status"] == "paid" and polled["bill"]["status"] == "paid"
    review = ok(client.get("/api/payments/review", headers=cashier))
    assert any(p["match_status"] == "failed" for p in review)


def test_known_vpa_links_walkin_payment(client, cashier):
    bill = new_bill(client, cashier, [(S["rice"], 1)])
    req = ok(client.post(f"/api/bills/{bill['id']}/checkout", headers=cashier, json={"upi_amount": 60}))["upi_request"]
    sim = ok(client.post(f"/api/upi/requests/{req['id']}/simulate", headers=cashier, json={"payer_vpa": "ravi@okicici"}))
    assert sim["request"]["bill"]["customer_id"] == S["ravi"]
    assert customer(client, cashier, S["ravi"])["balance"] == 800  # linked bill fully paid -> no change


def test_due_payment_settles_oldest_first(client, cashier, owner):
    ok(client.post(f"/api/customers/{S['ravi']}/payments", headers=cashier, json={"amount": 300, "mode": "cash"}))
    bills = ok(client.get(f"/api/customers/{S['ravi']}/bills", headers=cashier))
    opening = next(b for b in bills if b["bill_type"] == "opening")
    credit = next(b for b in bills if b["id"] == S["ravi_credit_bill"])
    assert opening["paid_amount"] == 300 and opening["status"] == "part_paid"
    assert credit["paid_amount"] == 0 and credit["status"] == "credit"
    assert customer(client, cashier, S["ravi"])["balance"] == 500
    # cashier cannot mark UPI manually; owner can, with UTR
    assert client.post(f"/api/customers/{S['ravi']}/payments", headers=cashier,
                       json={"amount": 10, "mode": "upi", "utr": "123456789012"}).status_code == 403
    ok(client.post(f"/api/customers/{S['ravi']}/payments", headers=owner,
                   json={"amount": 250, "mode": "upi", "utr": "UTR998877665"}))
    bills = ok(client.get(f"/api/customers/{S['ravi']}/bills", headers=cashier))
    assert next(b for b in bills if b["bill_type"] == "opening")["status"] == "paid"
    assert next(b for b in bills if b["id"] == S["ravi_credit_bill"])["paid_amount"] == 50


def test_payment_link_and_reminder(client, owner):
    link = ok(client.post(f"/api/customers/{S['ravi']}/payment-link", headers=owner, json={"amount": 100}))
    assert link["url"].endswith(f"/pay/{link['public_token']}") and link["is_link"]
    pub = ok(client.get(f"/api/public/pay/{link['public_token']}"))
    assert pub["amount"] == 100 and pub["status"] == "active" and pub["customer_name"] == "Ravi"
    pub = ok(client.post(f"/api/public/pay/{link['public_token']}/simulate", json={"payer_vpa": "ravi.wife@oksbi"}))
    assert pub["status"] == "paid"
    assert customer(client, owner, S["ravi"])["balance"] == 150
    rem = ok(client.post(f"/api/customers/{S['ravi']}/reminders", headers=owner, json={"channel": "whatsapp"}))
    assert rem["url"].startswith("https://wa.me/919876543210?text=") and "150.00" in rem["message"]
    assert client.post(f"/api/customers/{S['meena']}/reminders", headers=owner, json={}).status_code == 400  # no consent
    dues = ok(client.get("/api/dues?sort=amount", headers=owner))
    assert dues["customers"] == 2 and dues["total_due"] == 200


def test_returns(client, cashier, owner):
    # walk-in cash bill returned -> cash refund + stock back
    before = stock_of(client, owner, S["rice"])
    bill = new_bill(client, cashier, [(S["rice"], 4)])
    ok(client.post(f"/api/bills/{bill['id']}/checkout", headers=cashier, json={"cash_amount": 240}))
    item_id = ok(client.get(f"/api/bills/{bill['id']}", headers=owner))["items"][0]["id"]
    assert client.post(f"/api/bills/{bill['id']}/returns", headers=cashier, json={
        "items": [{"bill_item_id": item_id, "qty": 1}]}).status_code == 403
    r = ok(client.post(f"/api/bills/{bill['id']}/returns", headers=owner, json={
        "items": [{"bill_item_id": item_id, "qty": 1}], "refund_mode": "cash", "reason": "Damaged pack"}))
    assert r["amount"] == 60 and r["refund_amount"] == 60 and r["bill"]["status"] == "paid"
    assert stock_of(client, owner, S["rice"]) == before - 3
    assert client.post(f"/api/bills/{bill['id']}/returns", headers=owner, json={
        "items": [{"bill_item_id": item_id, "qty": 4}]}).status_code == 400
    # customer credit bill returned to ledger -> due reduced
    r = ok(client.post(f"/api/bills/{S['ravi_credit_bill']}/returns", headers=owner, json={
        "items": [{"bill_item_id": ok(client.get(f"/api/bills/{S['ravi_credit_bill']}", headers=owner))["items"][0]["id"], "qty": 1}],
        "refund_mode": "ledger"}))
    assert r["refund_amount"] == 0
    assert customer(client, owner, S["ravi"])["balance"] == 90


def test_writeoff_and_ledger_consistency(client, owner):
    ok(client.post(f"/api/customers/{S['ravi']}/writeoff", headers=owner, json={"amount": 40, "reason": "Rounding"}))
    led = ok(client.get(f"/api/customers/{S['ravi']}/ledger", headers=owner))
    assert led["entries"][-1]["balance_after"] == 50 == led["customer"]["balance"]
    running = 0
    for e in led["entries"]:
        running = round(running + e["debit"] - e["credit"], 2)
        assert running == e["balance_after"]
    bills = ok(client.get(f"/api/customers/{S['ravi']}/bills", headers=owner))
    assert round(sum(b["due_amount"] for b in bills), 2) == 50


def test_purchase_adjustment_and_count(client, owner, cashier):
    sup = ok(client.post("/api/suppliers", headers=owner, json={"name": "Agro Traders", "mobile": "9000011111",
                                                                  "gstin": "29ABCDE1234F1Z5"}))
    before = stock_of(client, owner, S["oil"])
    pur = ok(client.post("/api/purchases", headers=owner, json={
        "supplier_id": sup["id"], "invoice_no": "INV-1", "invoice_date": date.today().isoformat(),
        "items": [{"product_id": S["oil"], "qty": 12, "cost_price": 125, "batch_no": "B1",
                   "expiry_date": date.today().isoformat()}]}))
    assert pur["total"] == 1500 and stock_of(client, owner, S["oil"]) == before + 12
    assert client.post("/api/purchases", headers=owner, json={
        "supplier_id": sup["id"], "invoice_no": "INV-1", "invoice_date": date.today().isoformat(),
        "items": [{"product_id": S["oil"], "qty": 1, "cost_price": 1}]}).status_code == 400
    ok(client.post(f"/api/suppliers/{sup['id']}/payments", headers=owner, json={"amount": 1000}))
    detail = ok(client.get(f"/api/suppliers/{sup['id']}", headers=owner))
    assert detail["payable"] == 500 and detail["products"][0]["name"] == "Oil 1L"

    adj = ok(client.post("/api/stock/adjustments", headers=cashier, json={
        "product_id": S["oil"], "qty_change": -2, "reason": "damage", "note": "Leaking"}))
    assert adj["status"] == "pending"
    mid = stock_of(client, owner, S["oil"])
    assert client.post(f"/api/stock/adjustments/{adj['id']}/approve", headers=cashier).status_code == 403
    ok(client.post(f"/api/stock/adjustments/{adj['id']}/approve", headers=owner))
    assert stock_of(client, owner, S["oil"]) == mid - 2

    cnt = ok(client.post("/api/stock/counts", headers=cashier, json={"note": "Monthly"}))
    ok(client.post(f"/api/stock/counts/{cnt['id']}/items", headers=cashier, json={"product_id": S["oil"], "counted_qty": 10}))
    cnt = ok(client.post(f"/api/stock/counts/{cnt['id']}/items", headers=cashier, json={"product_id": S["oil"], "increment": 1}))
    assert cnt["items"][0]["counted_qty"] == 11
    posted = ok(client.post(f"/api/stock/counts/{cnt['id']}/post", headers=owner))
    assert posted["status"] == "posted" and stock_of(client, owner, S["oil"]) == 11
    types = {m["movement_type"] for m in ok(client.get(f"/api/products/{S['oil']}/movements", headers=owner))}
    assert {"opening", "purchase", "adjustment", "count"} <= types
    assert ok(client.get("/api/reports/expiry", headers=owner))[0]["name"] == "Oil 1L"


def test_dashboard_reports_exports(client, owner):
    s = ok(client.get("/api/dashboard/summary", headers=owner))
    assert s["sales"] > 0 and s["bill_count"] >= 5
    split = s["sales_by_mode"]
    assert round(split["upi"] + split["cash"] + split["credit"], 2) == s["sales"]
    for g in ("day", "week", "month"):
        t = ok(client.get(f"/api/dashboard/trend?granularity={g}", headers=owner))
        assert len(t["labels"]) == len(t["current"]) == len(t["previous"])
    ins = ok(client.get("/api/dashboard/insights?days=30", headers=owner))
    assert ins["top_products"][0]["name"] == "Rice 1kg" and len(ins["peak_hours"]["bills"]) == 24
    assert len(ins["dues_ageing"]["amounts"]) == 3
    for path in ("stock", "sales-by-product", "movement-class", "reorder"):
        ok(client.get(f"/api/reports/{path}", headers=owner))
    for kind in ("bills", "payments", "dues", "stock", "sales"):
        x = client.get(f"/api/exports/{kind}?format=xlsx", headers=owner)
        assert x.status_code == 200 and x.content[:2] == b"PK"
        p = client.get(f"/api/exports/{kind}?format=pdf", headers=owner)
        assert p.status_code == 200 and p.content[:4] == b"%PDF"


def test_reconciliation(client, owner):
    from app.database import SessionLocal
    from app.services.gateway import get_gateway

    # A payment the gateway captured but whose webhook never reached the app (and nobody polled)
    with SessionLocal() as db:
        get_gateway("mock").record_txn(db, gateway_qr_id=None, reference="CUST999-LOST", amount=75,
                                       status="success", payer_vpa="ravi@okicici", payer_name="Ravi")
        db.commit()
    today = date.today().isoformat()
    rep = ok(client.post(f"/api/recon/fetch?for_date={today}", headers=owner))
    missing = [g for g in rep["gaps"] if g["type"] == "missing_in_app"]
    assert len(missing) == 1 and rep["status"] == "gaps"
    rep = ok(client.post(f"/api/recon/items/{missing[0]['item_id']}/import", headers=owner))
    assert not [g for g in rep["gaps"] if g["type"] in ("missing_in_app", "not_settled")]
    assert rep["totals"]["app_upi"] == rep["totals"]["gateway_gross"]
    s = rep["settlements"][0]
    rep = ok(client.post(f"/api/recon/settlements/{s['id']}/bank-credit", headers=owner, json={"amount": s["net"]}))
    assert rep["status"] == "matched"
    # the imported payment was auto-linked to Ravi by his known UPI ID (FR-17)
    assert customer(client, owner, S["ravi"])["balance"] == -25
    assert len(ok(client.get("/api/recon/summary?days=3", headers=owner))) == 3
    assert ok(client.get("/api/recon/webhooks", headers=owner))


def test_audit_and_notifications(client, owner, cashier):
    log = ok(client.get("/api/audit?page_size=200", headers=owner))
    actions = {r["action"] for r in log["rows"]}
    assert {"login", "discount", "delete", "return", "writeoff", "adjustment"} <= actions
    n = ok(client.get("/api/notifications", headers=cashier))
    assert "items" in n
    assert client.get("/api/audit", headers=cashier).status_code == 403


@pytest.mark.parametrize("path", ["/api/health", "/api/upi/active", "/api/settings", "/api/categories"])
def test_misc_endpoints(client, owner, path):
    ok(client.get(path, headers=owner))


def test_daily_collections(client, owner, cashier):
    d = ok(client.get("/api/payments/daily", headers=owner))
    assert len(d["labels"]) == 14 == len(d["upi"]) == len(d["cash"])
    assert d["totals"]["upi"] > 0 and d["totals"]["cash"] > 0
    assert client.get("/api/payments/daily", headers=cashier).status_code == 403
    assert client.get("/api/payments/daily?date_from=2026-02-01&date_to=2026-01-01", headers=owner).status_code == 400
