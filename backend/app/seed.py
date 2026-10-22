"""Load ~90 days of realistic demo data.

    python -m app.seed            # only when the database has no products yet
    python -m app.seed --reset    # DROP all tables and start again

Everything is created through the same services the API uses, so stock, ledger, payments and
settlements are consistent.
"""

import argparse
import random
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.exc import OperationalError

from .database import Base, SessionLocal, engine, ensure_database, safe_db_url
from .main import init_db
from .models import (
    Bill,
    Category,
    Customer,
    CustomerVPA,
    Product,
    Purchase,
    PurchaseItem,
    StockAdjustment,
    Supplier,
    SupplierPayment,
    User,
)
from .routers.bills import _create_draft
from .routers.inventory import _apply_adjustment
from .schemas import BillIn, BillItemIn, ReturnItemIn
from .security import hash_password
from .services import app_settings
from .services.billing import apply_discount, assign_bill_no, checkout, create_return, record_payment
from .services.gateway import get_gateway
from .services.gateway.base import NormalizedPayment
from .services.ledger import add_ledger, post_payment_ledger, refresh_bill_and_customer
from .services.recon import fetch_settlements
from .services.stock import post_movement
from .services.upi import create_upi_request, process_gateway_payment
from .utils import D, ean13_check_digit, money, now, set_frozen_now, today

DAYS = 90

# (name, cost price, selling price, reorder level, popularity)
CATEGORIES = {
    "Indoor Plants": [
        ("Money Plant (Pothos) 6in Pot", 90, 149, 8, 10), ("Snake Plant (Sansevieria) 8in Pot", 180, 299, 6, 8),
        ("ZZ Plant 8in Pot", 260, 449, 4, 5), ("Peace Lily 6in Pot", 150, 249, 5, 6),
        ("Areca Palm 10in Pot", 320, 549, 3, 4), ("Rubber Plant 8in Pot", 220, 379, 4, 4),
        ("Jade Plant 4in Pot", 60, 99, 8, 7), ("Monstera Deliciosa 10in Pot", 480, 799, 2, 2),
    ],
    "Flowering Plants": [
        ("Rose (Hybrid) 8in Bag", 70, 120, 10, 9), ("Hibiscus 8in Bag", 80, 140, 6, 6),
        ("Jasmine (Mallige) 8in Bag", 70, 120, 6, 6), ("Bougainvillea 8in Bag", 90, 160, 5, 4),
        ("Adenium (Desert Rose) 6in Pot", 180, 320, 3, 2), ("Marigold Seedlings (Tray of 6)", 30, 60, 8, 5),
    ],
    "Succulents & Cacti": [
        ("Echeveria 3in Pot", 45, 89, 8, 5), ("Aloe Vera 6in Pot", 60, 110, 6, 6),
        ("Haworthia 3in Pot", 50, 99, 5, 3), ("Succulent Combo Bowl", 180, 349, 3, 2),
    ],
    "Fruit & Herb Plants": [
        ("Curry Leaf Plant 8in Bag", 60, 110, 6, 6), ("Tulsi (Holy Basil) 6in Bag", 30, 60, 10, 8),
        ("Lemon Plant (Grafted)", 120, 220, 4, 4), ("Guava Plant (Grafted)", 140, 250, 3, 3),
        ("Mango Plant Alphonso (Grafted)", 220, 399, 3, 2),
    ],
    "Seeds": [
        ("Tomato Seeds (Packet)", 18, 35, 15, 6), ("Coriander Seeds 100g", 25, 45, 10, 5),
        ("Marigold Seeds (Packet)", 20, 40, 10, 4), ("Microgreens Mix 50g", 60, 110, 5, 3),
    ],
    "Pots & Planters": [
        ("Plastic Pot 6in", 18, 35, 20, 11), ("Plastic Pot 8in", 28, 55, 15, 9),
        ("Terracotta Pot 8in", 55, 99, 10, 6), ("Terracotta Pot 12in", 120, 210, 5, 3),
        ("Ceramic Planter 6in", 180, 349, 3, 2), ("Grow Bag 12x12in", 22, 45, 20, 7),
    ],
    "Soil & Fertilizers": [
        ("Potting Mix 5kg", 90, 160, 10, 9), ("Vermicompost 5kg", 75, 140, 8, 7),
        ("Cocopeat Block 5kg", 85, 150, 6, 5), ("Neem Cake Powder 1kg", 45, 85, 6, 4),
        ("NPK 19:19:19 500g", 70, 130, 5, 3), ("Red Garden Soil (Loose)", 6, 12, 15, 5),
    ],
    "Garden Tools & Care": [
        ("Hand Trowel", 75, 140, 4, 3), ("Pruning Secateurs", 220, 399, 3, 2), ("Watering Can 5L", 140, 249, 3, 2),
        ("Spray Bottle 1L", 45, 89, 5, 3), ("Neem Oil Spray 250ml", 95, 170, 5, 3), ("Garden Gloves (Pair)", 60, 120, 5, 3),
    ],
}
NO_BARCODE = {"Marigold Seedlings (Tray of 6)", "Red Garden Soil (Loose)", "Tulsi (Holy Basil) 6in Bag", "Succulent Combo Bowl"}
LOOSE = {"Red Garden Soil (Loose)"}  # sold by the kg
LET_RUN_LOW = {"Monstera Deliciosa 10in Pot", "Adenium (Desert Rose) 6in Pot", "Pruning Secateurs", "Ceramic Planter 6in"}
# Products with a shelf life: (min, max) days from purchase to expiry
PERISHABLE = {
    "Marigold Seedlings (Tray of 6)": (6, 14), "Microgreens Mix 50g": (20, 60),
    "Tomato Seeds (Packet)": (25, 90), "Neem Oil Spray 250ml": (40, 120),
}

SUPPLIERS = [
    ("Green Leaf Nursery Wholesale", "9845011122", "29AAKFG1234A1Z5",
     {"Indoor Plants", "Flowering Plants", "Succulents & Cacti", "Fruit & Herb Plants"}),
    ("Sahyadri Seeds & Agro Inputs", "9845033344", "29AABCS5678B1Z2", {"Seeds", "Soil & Fertilizers"}),
    ("Kumbara Clay & Planters", "9845055566", "29AAACK9012C1Z8", {"Pots & Planters"}),
    ("Kisan Garden Tools Traders", "9845077788", "29AADCK3456D1Z1", {"Garden Tools & Care"}),
]

CUSTOMERS = [
    ("Ravi Kumar", "9876543210", ["ravikumar@okicici"], True, 0),
    ("Lakshmi Narayanan", "9845098450", ["lakshmi.n@oksbi"], True, 650),
    ("Mohammed Irfan", "9900112233", ["irfan786@ybl"], True, 0),
    ("Priya Sharma", "9886012345", ["priyasharma@okaxis"], True, 0),
    ("Green Spaces Landscaping", "9731234567", ["greenspaces@okhdfcbank"], True, 2400),
    ("Anitha Reddy", "9008765432", ["anithar@okhdfcbank"], True, 0),
    ("Joseph Thomas", "9945612378", [], False, 0),
    ("Kavya Rao", "9620456789", ["kavya.rao@ibl"], True, 0),
    ("Venkatesh Iyer", "9448123456", ["venky@oksbi"], True, 0),
    ("Fathima Begum", "9590345678", [], True, 0),
    ("Arjun Patil", "9741987654", ["arjunp@ybl"], True, 0),
    ("Deepa Menon", "9886754321", ["deepa.m@okaxis"], False, 0),
    ("Sunrise Apartments RWA", "9480123987", ["sunrise.rwa@paytm"], True, 1500),
    ("Shalini Verma", "9611234598", ["shaliniv@okicici"], True, 0),
    ("Ramesh Babu", "9036547812", [], True, 300),
]

# Nursery traffic: busy mornings and early evenings
HOUR_WEIGHTS = {7: 3, 8: 6, 9: 8, 10: 9, 11: 8, 12: 5, 13: 3, 14: 3, 15: 4, 16: 7, 17: 9, 18: 8, 19: 4}


def _ean13(rng: random.Random, used: set) -> str:
    while True:
        first12 = "890" + "".join(rng.choices("0123456789", k=9))
        code = first12 + ean13_check_digit(first12)
        if code not in used:
            used.add(code)
            return code


def _random_time(rng: random.Random, d: date) -> datetime:
    hours = list(HOUR_WEIGHTS)
    h = rng.choices(hours, weights=[HOUR_WEIGHTS[x] for x in hours])[0]
    return datetime.combine(d, time(h, rng.randint(0, 59), rng.randint(0, 59)))


def _pay_upi(db, req, rng, payer_vpa=None, payer_name=None, amount=None, fail_first=False):
    gw = get_gateway("mock")
    if fail_first:
        t = gw.record_txn(db, gateway_qr_id=req.gateway_qr_id, reference=req.ref, amount=req.amount, status="failed",
                          payer_vpa=payer_vpa, payer_name=payer_name, error_reason="Transaction declined by bank")
        process_gateway_payment(db, NormalizedPayment(status="failed", gateway_payment_id=t.gateway_payment_id,
                                                      amount=t.amount, gateway_qr_id=t.gateway_qr_id,
                                                      reference=t.reference, payer_vpa=payer_vpa,
                                                      error_reason=t.error_reason))
    t = gw.record_txn(db, gateway_qr_id=req.gateway_qr_id, reference=req.ref, amount=amount or req.amount,
                      status="success", payer_vpa=payer_vpa, payer_name=payer_name)
    return process_gateway_payment(db, NormalizedPayment(
        status="success", gateway_payment_id=t.gateway_payment_id, amount=t.amount, gateway_qr_id=t.gateway_qr_id,
        reference=t.reference, utr=t.utr, payer_vpa=payer_vpa, payer_name=payer_name), source="webhook")


def seed(reset: bool = False) -> None:
    ensure_database()
    if reset:
        Base.metadata.drop_all(bind=engine)
    init_db()
    rng = random.Random(2026)
    start_day = today() - timedelta(days=DAYS - 1)
    real_now = now() - timedelta(minutes=5)  # nothing in the demo data may happen in the future

    with SessionLocal() as db:
        if db.execute(select(func.count(Product.id))).scalar():
            print("Database already has products. Run `python -m app.seed --reset` to start from scratch.")
            return
        owner = db.execute(select(User).where(User.role == "owner").order_by(User.id)).scalars().first()
        cashier = db.execute(select(User).where(User.username == "cashier")).scalar_one_or_none()
        if cashier is None:
            cashier = User(name="Counter Staff", username="cashier", password_hash=hash_password("cashier123"), role="cashier")
            db.add(cashier)
        # Address, phone, GSTIN and the real UPI ID are filled in by the owner under Settings.
        app_settings.update(db, {
            "shop_name": "Plant Technocrat", "shop_tagline": "Growing Green Futures",
            "upi_vpa": "planttechnocrat@demo", "upi_payee_name": "Plant Technocrat",
            "receipt_footer": "Thank you for growing green with us!",
        })
        db.commit()

        set_frozen_now(datetime.combine(start_day - timedelta(days=1), time(9, 0)))

        used_codes: set[str] = set()
        products: list[tuple[Product, int, str]] = []  # (product, popularity, category)
        for cat_name, rows in CATEGORIES.items():
            cat = Category(name=cat_name)
            db.add(cat)
            db.flush()
            for name, cost, sell, reorder, popularity in rows:
                p = Product(
                    name=name, category_id=cat.id, barcode=None if name in NO_BARCODE else _ean13(rng, used_codes),
                    unit="kg" if name in LOOSE else "pcs", cost_price=money(cost), selling_price=money(sell),
                    stock_qty=0, reorder_level=reorder, track_expiry=name in PERISHABLE,
                )
                db.add(p)
                db.flush()
                products.append((p, popularity, cat_name))

        suppliers = []
        for name, mobile, gstin, cats in SUPPLIERS:
            s = Supplier(name=name, mobile=mobile, gstin=gstin, address="Bengaluru")
            db.add(s)
            db.flush()
            suppliers.append((s, cats))


        invoice_counter = [1000]

        def purchase(d: date, items: list[tuple[Product, int]]):
            by_supplier: dict[int, list] = {}
            for p, q in items:
                cat = next(c for (pp, _, c) in products if pp.id == p.id)
                sup = next(s for s, cats in suppliers if cat in cats)
                by_supplier.setdefault(sup.id, []).append((p, q))
            for sid, lines in by_supplier.items():
                invoice_counter[0] += 1
                pur = Purchase(supplier_id=sid, invoice_no=f"INV-{invoice_counter[0]}", invoice_date=d,
                               created_by=owner.id)
                db.add(pur)
                db.flush()
                total = Decimal("0")
                for p, q in lines:
                    line = money(D(q) * D(p.cost_price))
                    total += line
                    expiry = d + timedelta(days=rng.randint(*PERISHABLE[p.name])) if p.track_expiry else None
                    pur.items.append(PurchaseItem(product_id=p.id, qty=q, cost_price=p.cost_price, line_total=line,
                                                  batch_no=f"BT{d:%m%d}{p.id}" if expiry else None, expiry_date=expiry))
                    post_movement(db, p.id, "purchase", qty_in=q, ref_type="purchase", ref_id=pur.id,
                                  ref_label=f"INV-{invoice_counter[0]}", user=owner)
                pur.total = money(total)
                if rng.random() < 0.8:
                    db.add(SupplierPayment(supplier_id=sid, amount=money(total), mode=rng.choice(["upi", "bank", "cash"]),
                                           paid_on=d + timedelta(days=rng.randint(0, 7)), created_by=owner.id,
                                           reference=f"PAY{invoice_counter[0]}"))

        # opening stock: ~40 days of sales
        purchase(start_day - timedelta(days=1), [(p, max(15, pop * 9)) for p, pop, _ in products])

        customers = []
        for name, mobile, vpas, consent, opening in CUSTOMERS:
            c = Customer(name=name, mobile=mobile, whatsapp_consent=consent, opening_balance=money(opening))
            db.add(c)
            db.flush()

            for v in vpas:
                db.add(CustomerVPA(customer_id=c.id, vpa=v))
            if opening:
                ob = Bill(bill_type="opening", customer_id=c.id, status="credit", subtotal=money(opening),
                          total=money(opening), created_by=owner.id, notes="Opening balance (paper book)")
                db.add(ob)
                assign_bill_no(db, ob)
                ob.completed_at = now()
                add_ledger(db, c.id, "opening", debit=ob.total, description="Opening balance", bill_id=ob.id)
                refresh_bill_and_customer(db, ob)
            customers.append((c, vpas))
        db.commit()

        regular_weights = [rng.randint(1, 8) for _ in customers]
        returned = 0
        for day_index in range(DAYS):
            d = start_day + timedelta(days=day_index)
            # restock weekly (a few items miss the last restocks so low-stock alerts show up)
            if day_index and day_index % 7 == 0 and datetime.combine(d, time(8, 15)) <= real_now:
                set_frozen_now(datetime.combine(d, time(8, 15)))
                restock = []
                for p, pop, _ in products:
                    db.refresh(p)
                    target = max(15, pop * 9)
                    if D(p.stock_qty) < target * Decimal("0.6") and not (day_index > DAYS - 25 and p.name in LET_RUN_LOW):
                        restock.append((p, int(target - D(p.stock_qty)) + rng.randint(0, 5)))
                if restock:
                    purchase(d, restock)
                    db.commit()

            weekend = d.weekday() >= 5
            growth = 1 + day_index / DAYS * 0.35
            n_bills = int(rng.randint(9, 16) * (1.5 if weekend else 1) * growth)
            times = sorted(t for t in (_random_time(rng, d) for _ in range(n_bills)) if t <= real_now)
            for t in times:
                set_frozen_now(t)
                is_customer = rng.random() < 0.45
                cust, vpas = rng.choices(customers, weights=regular_weights)[0] if is_customer else (None, [])
                picks = rng.choices(products, weights=[pop for _, pop, _ in products], k=rng.randint(1, 5))
                items = {}
                for p, _, _ in picks:
                    q = Decimal(rng.choice(["2", "5", "5", "10"])) if p.name in LOOSE else Decimal(rng.choice([1, 1, 1, 2, 3]))
                    db.refresh(p)
                    if D(p.stock_qty) - items.get(p.id, Decimal("0")) >= q:
                        items[p.id] = items.get(p.id, Decimal("0")) + q
                if not items:
                    continue
                user = owner if rng.random() < 0.3 else cashier
                body = BillIn(customer_id=cust.id if cust else None,
                              items=[BillItemIn(product_id=pid, qty=float(q)) for pid, q in items.items()])
                bill = _create_draft(db, body, user)
                if rng.random() < 0.08:
                    apply_discount(db, bill, money(D(bill.subtotal) * Decimal("0.05")), owner)
                total = D(bill.total)
                r = rng.random()
                if cust is None:
                    mode = "upi" if r < 0.62 else "cash"
                else:
                    mode = "upi" if r < 0.45 else ("cash" if r < 0.62 else ("credit" if r < 0.88 else "split"))
                if mode == "cash":
                    checkout(db, bill, total, 0, user)
                elif mode == "credit":
                    checkout(db, bill, 0, 0, user)
                elif mode == "split":
                    cash_part = money(total * Decimal(rng.choice(["0.3", "0.5"])))
                    req = checkout(db, bill, cash_part, money(total - cash_part), user)
                    _pay_upi(db, req, rng, payer_vpa=vpas[0] if vpas else f"user{rng.randint(100, 999)}@ybl",
                             payer_name=cust.name)
                else:
                    req = checkout(db, bill, 0, total, user)
                    payer_vpa = vpas[0] if vpas else f"{rng.choice(['pay', 'upi', 'user'])}{rng.randint(1000, 9999)}@{rng.choice(['ybl', 'okaxis', 'paytm', 'oksbi'])}"
                    payer_name = cust.name if cust else rng.choice(["R Kumar", "S Devi", "A Khan", "M Rao", "P Singh"])
                    _pay_upi(db, req, rng, payer_vpa=payer_vpa, payer_name=payer_name, fail_first=rng.random() < 0.05)
                db.commit()

                # occasional returns
                if returned < 4 and day_index in (20, 41, 63, 77) and bill.completed_at and rng.random() < 0.5:
                    item = bill.items[0]
                    create_return(db, bill, [ReturnItemIn(bill_item_id=item.id, qty=1 if D(item.qty) >= 1 else float(item.qty))],
                                  "ledger" if bill.customer_id and bill.status != "paid" else "cash",
                                  "Plant damaged / pot cracked", owner)
                    returned += 1
                    db.commit()

            # dues collection in the evening: some customers settle part of their balance
            if datetime.combine(d, time(19, 45)) > real_now:
                continue
            set_frozen_now(datetime.combine(d, time(19, 45)))
            for c, vpas in customers:
                db.refresh(c)
                if D(c.balance) > 200 and rng.random() < 0.12:
                    amount = money(D(c.balance) * Decimal(rng.choice(["0.4", "0.6", "1"])))
                    if vpas and rng.random() < 0.6:
                        req = create_upi_request(db, amount=amount, purpose="due", customer_id=c.id, user=owner,
                                                 as_link=rng.random() < 0.5)
                        _pay_upi(db, req, rng, payer_vpa=vpas[0], payer_name=c.name)
                    else:
                        p = record_payment(db, amount=amount, mode="cash", customer_id=c.id, user=cashier)
                        post_payment_ledger(db, p)
                        refresh_bill_and_customer(db, customer_id=c.id)
                    db.commit()

            if day_index in (15, 50, 80):
                set_frozen_now(datetime.combine(d, time(21, 30)))
                p, _, _ = rng.choice([x for x in products if x[0].track_expiry])
                adj = StockAdjustment(product_id=p.id, qty_change=-2, reason="wastage", note="Wilted / past expiry",
                                      status="pending", requested_by=cashier.id)
                db.add(adj)
                db.flush()
                _apply_adjustment(db, adj, owner)
                db.commit()

        # settlements T+1 and bank credits (last two days left unconfirmed; one missed webhook to import)
        set_frozen_now(datetime.combine(today() - timedelta(days=2), time(16, 20)))
        gw = get_gateway("mock")
        lost_customer, lost_vpas = customers[0]
        gw.record_txn(db, gateway_qr_id=None, reference=f"CUST{lost_customer.id}-LOSTWH", amount=money(350),
                      status="success", payer_vpa=lost_vpas[0], payer_name=lost_customer.name)
        db.commit()
        set_frozen_now(None)
        for offset in range(DAYS - 1, 0, -1):
            d = today() - timedelta(days=offset)
            for s in fetch_settlements(db, d):
                if offset >= 3:
                    s.bank_credit_amount = s.net
                    s.bank_credit_date = s.settlement_date
                    s.bank_credit_ref = s.bank_utr
            db.commit()

        pending_product = next(p for p, _, _ in products if p.name == "Terracotta Pot 8in")
        db.add(StockAdjustment(product_id=pending_product.id, qty_change=-1, reason="damage",
                               note="Pot cracked while unloading", status="pending", requested_by=cashier.id))
        db.commit()

        bill_count = db.execute(select(func.count(Bill.id)).where(Bill.bill_type == "sale")).scalar()
        print(f"Seeded {len(products)} products, {len(customers)} customers and {bill_count} bills over {DAYS} days.")
        print("Logins:  owner / owner123   (owner)      cashier / cashier123   (cashier)")


def main():
    parser = argparse.ArgumentParser(description="Load demo data")
    parser.add_argument("--reset", action="store_true", help="drop all tables before seeding")
    args = parser.parse_args()
    try:
        seed(reset=args.reset)
    except OperationalError as exc:
        raise SystemExit(
            f"Cannot connect to MySQL at {safe_db_url()}: {exc.orig}\n"
            "Start MySQL and check DATABASE_URL in backend/.env."
        ) from None


if __name__ == "__main__":
    main()
