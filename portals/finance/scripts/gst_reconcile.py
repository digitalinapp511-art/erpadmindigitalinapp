"""
GST Reconcile utilities for Amazon, Retail/Export, JioMart, and generic merges.
Uses pandas-based processing. All file paths are plain strings; no GUI/tooling.
"""

import argparse
import calendar
import glob
import os
import sys
import traceback
import pandas as pd


def numeric_col(df, col, default=0):
    """Return a numeric Series for col; if missing, return a zero-filled Series."""
    if col in df:
        return pd.to_numeric(df[col], errors="coerce").fillna(default)
    return pd.Series([default] * len(df))


def str_col(df, col, default=""):
    """Return a string Series for col; if missing, return a default-filled Series."""
    if col in df:
        return df[col].astype(str)
    return pd.Series([default] * len(df))


# ------------------------------
# Helper functions (same mapping/logic)
# ------------------------------

def map_state_column(series):
    """Return mapped state codes (same mapping used across scripts)."""
    state_mapping = {
        "JAMMU AND KASHMIR": "01-JAMMU AND KASHMIR",
        "HIMACHAL PRADESH": "02-HIMACHAL PRADESH",
        "PUNJAB": "03-PUNJAB",
        "CHANDIGARH": "04-CHANDIGARH",
        "UTTARAKHAND": "05-UTTARAKHAND",
        "HARYANA": "06-HARYANA",
        "DELHI": "07-DELHI",
        "RAJASTHAN": "08-RAJASTHAN",
        "UTTAR PRADESH": "09-UTTAR PRADESH",
        "BIHAR": "10-BIHAR",
        "SIKKIM": "11-SIKKIM",
        "ARUNACHAL PRADESH": "12-ARUNACHAL PRADESH",
        "NAGALAND": "13-NAGALAND",
        "MANIPUR": "14-MANIPUR",
        "MIZORAM": "15-MIZORAM",
        "TRIPURA": "16-TRIPURA",
        "MEGHALAYA": "17-MEGHALAYA",
        "ASSAM": "18-ASSAM",
        "WEST BENGAL": "19-WEST BENGAL",
        "JHARKHAND": "20-JHARKHAND",
        "ODISHA": "21-ODISHA",
        "CHHATTISGARH": "22-CHHATTISGARH",
        "MADHYA PRADESH": "23-MADHYA PRADESH",
        "GUJARAT": "24-GUJARAT",
        "DAMAN AND DIU": "25-DAMAN AND DIU",
        "DADRA AND NAGAR HAVELI": "26-DADRA AND NAGAR HAVELI",
        "MAHARASHTRA": "27-MAHARASHTRA",
        "KARNATAKA": "29-KARNATAKA",
        "GOA": "30-GOA",
        "LAKSHADWEEP": "31-LAKSHADWEEP",
        "KERALA": "32-KERALA",
        "TAMIL NADU": "33-TAMIL NADU",
        "PUDUCHERRY": "34-PUDUCHERRY",
        "ANDAMAN AND NICOBAR": "35-ANDAMAN AND NICOBAR",
        "TELANGANA": "36-TELANGANA",
        "ANDHRA PRADESH": "37-ANDHRA PRADESH",
        "LADAKH": "38-LADAKH",
        "OTHER TERRITORY": "97-OTHER TERRITORY",
        "OTHER COUNTRY": "96-OTHER COUNTRY",
    }
    return series.astype(str).str.strip().str.upper().map(state_mapping)


# ------------------------------
# Amazon processing
# ------------------------------

def process_amazon_files(mtr_path, b2c_path, stock_path, save_path):
    """
    Process MTR (B2B), B2C and Stock Transfer files with the same logic as tk_gst_test_forpy
    and save a combined CSV at save_path.
    """
    try:
        # ---------- MTR (B2B) ----------
        mtr = pd.read_csv(mtr_path, low_memory=False)

        if "Transaction Type" in mtr.columns:
            mtr = mtr[mtr["Transaction Type"].astype(str).str.lower() != "cancel"]
            mtr["Transaction Type"] = (
                mtr["Transaction Type"]
                .astype(str)
                .str.strip()
                .str.title()
                .replace({"Shipment": "Order"})
            )

        mtr["Ship To State"] = mtr.get("Ship To State", "").astype(str).str.strip().str.upper()
        mtr["order_state_mapped"] = map_state_column(mtr["Ship To State"])

        # Date field (Credit Note Date if refund else Invoice Date)
        mtr["Date_tmp"] = mtr.apply(
            lambda x: x.get("Credit Note Date")
            if str(x.get("Transaction Type")).strip().lower() == "refund"
            else x.get("Invoice Date"),
            axis=1,
        )
        mtr["Date"] = pd.to_datetime(mtr["Date_tmp"], errors="coerce")

        rates = ["Cgst Rate", "Sgst Rate", "Igst Rate", "Utgst Rate"]
        for r in rates:
            mtr[r] = numeric_col(mtr, r, 0)
        mtr["GST Rate"] = (mtr[rates].sum(axis=1) * 100).round(2)

        mtr["Principal Amount Basis"] = numeric_col(mtr, "Principal Amount Basis", 0)
        mtr["Tax"] = (mtr["Principal Amount Basis"] * (mtr["GST Rate"] / 100)).round(2)
        mtr["Invoice Value"] = (mtr["Principal Amount Basis"] + mtr["Tax"]).round(2)

        mtr["Seller Gstin"] = str_col(mtr, "Seller Gstin", "")
        mtr["Inter/Intra"] = mtr.apply(
            lambda x: "Intra"
            if str(x["Seller Gstin"])[:2] == str(x["order_state_mapped"])[:2]
            else "Inter",
            axis=1,
        )

        mtr["IGST"] = mtr.apply(lambda x: x["Tax"] if x["Inter/Intra"] == "Inter" else 0, axis=1).round(2)
        mtr["CGST"] = mtr.apply(lambda x: x["Tax"] / 2 if x["Inter/Intra"] == "Intra" else 0, axis=1).round(2)
        mtr["SGST"] = mtr.apply(lambda x: x["Tax"] / 2 if x["Inter/Intra"] == "Intra" else 0, axis=1).round(2)

        mtr["Invoice Date_dt"] = pd.to_datetime(mtr.get("Invoice Date"), errors="coerce")
        mtr["Period"] = mtr["Invoice Date_dt"].apply(
            lambda d: f"{calendar.monthrange(d.year, d.month)[1]:02d}-{d.strftime('%b-%Y')}"
            if pd.notnull(d)
            else ""
        )

        mtr["Invoice Number/CN"] = mtr.apply(
            lambda x: x.get("Credit Note No")
            if str(x.get("Transaction Type")).lower() == "refund"
            else x.get("Invoice Number"),
            axis=1,
        )

        mtr_total_sum = mtr.groupby("Invoice Number/CN")["Invoice Value"].transform("sum")

        mtr_final = pd.DataFrame(
            {
                "Supplier GSTID": mtr.get("Seller Gstin"),
                "Buyer GST": mtr.get("Customer Bill To Gstid"),
                "Buyer Name": mtr.get("Buyer Name"),
                "Date": mtr.get("Invoice Date_dt"),
                "Time": "",
                "type": mtr.get("Transaction Type"),
                "Order ID": mtr.get("Order Id"),
                "SKU": mtr.get("Sku"),
                "description": mtr.get("Item Description"),
                "Category": "",
                "Qty": mtr.get("Quantity"),
                "marketplace": "Amazon B2B",
                "order state": mtr.get("order_state_mapped"),
                "Invoice Number/CN": mtr["Invoice Number/CN"],
                "HSN": mtr.get("Hsn/sac"),
                "B2B/B2C": "B2B",
                "Inter/Intra": mtr.get("Inter/Intra"),
                "GST Rate": mtr.get("GST Rate"),
                "product sales": mtr.get("Principal Amount Basis"),
                "shipping credits": "-",
                "promotional rebates": "-",
                "Invoice Total": mtr_total_sum,
                "Invoice Value": mtr.get("Invoice Value"),
                "Tax": mtr.get("Tax"),
                "Taxable Value": mtr.get("Principal Amount Basis"),
                "IGST": mtr.get("IGST"),
                "CGST": mtr.get("CGST"),
                "SGST": mtr.get("SGST"),
                "TCS-IGST": mtr.get("Tcs Igst Amount") if "Tcs Igst Amount" in mtr.columns else None,
                "TCS-CGST": mtr.get("Tcs Cgst Amount") if "Tcs Cgst Amount" in mtr.columns else None,
                "TCS-SGST": mtr.get("Tcs Sgst Amount") if "Tcs Sgst Amount" in mtr.columns else None,
                "TDS": "-",
                "Nature": "-",
                "Period": mtr.get("Period"),
                "E Invoice Status": mtr.get("Irn Filing Status")
                if "Irn Filing Status" in mtr.columns
                else None,
                "E Invoice IRN": mtr.get("Irn Number") if "Irn Number" in mtr.columns else None,
                "Invoice Status": "-",
                "E way Bill number": "-",
            }
        )

        # ---------- B2C ----------
        b2c = pd.read_csv(b2c_path, low_memory=False)

        if "Transaction Type" in b2c.columns:
            b2c = b2c[b2c["Transaction Type"].astype(str).str.lower() != "cancel"]
            b2c["Transaction Type"] = (
                b2c.get("Transaction Type", "")
                .astype(str)
                .replace(
                    {
                        "Shipment": "Order",
                        "shipment": "Order",
                        "FreeReplacement": "Order",
                        "Freereplacement": "Order",
                    }
                )
            )

        b2c["Ship To State"] = b2c.get("Ship To State", "").astype(str).str.strip().str.upper()
        b2c["order_state_mapped"] = map_state_column(b2c["Ship To State"])

        b2c["Date_tmp"] = b2c.apply(
            lambda x: x.get("Credit Note Date")
            if str(x.get("Transaction Type")).strip().lower() == "refund"
            else x.get("Invoice Date"),
            axis=1,
        )
        b2c["Date"] = pd.to_datetime(b2c["Date_tmp"], errors="coerce")

        rates = ["Cgst Rate", "Sgst Rate", "Igst Rate", "Utgst Rate"]
        for r in rates:
            b2c[r] = numeric_col(b2c, r, 0)
        b2c["GST Rate"] = (b2c[rates].sum(axis=1) * 100).round(2)

        b2c["Principal Amount Basis"] = numeric_col(b2c, "Principal Amount Basis", 0)
        b2c["Tax"] = (b2c["Principal Amount Basis"] * (b2c["GST Rate"] / 100)).round(2)
        b2c["Invoice Value"] = (b2c["Principal Amount Basis"] + b2c["Tax"]).round(2)

        b2c["Seller Gstin"] = str_col(b2c, "Seller Gstin", "")
        b2c["Inter/Intra"] = b2c.apply(
            lambda x: "Intra"
            if str(x["Seller Gstin"])[:2] == str(x["order_state_mapped"])[:2]
            else "Inter",
            axis=1,
        )

        b2c["IGST"] = b2c.apply(lambda x: x["Tax"] if x["Inter/Intra"] == "Inter" else 0, axis=1).round(2)
        b2c["CGST"] = b2c.apply(lambda x: x["Tax"] / 2 if x["Inter/Intra"] == "Intra" else 0, axis=1).round(2)
        b2c["SGST"] = b2c.apply(lambda x: x["Tax"] / 2 if x["Inter/Intra"] == "Intra" else 0, axis=1).round(2)

        b2c["Invoice Date_dt"] = pd.to_datetime(b2c.get("Invoice Date"), errors="coerce")
        b2c["Period"] = b2c["Invoice Date_dt"].apply(
            lambda d: f"{calendar.monthrange(d.year, d.month)[1]:02d}-{d.strftime('%b-%Y')}"
            if pd.notnull(d)
            else ""
        )

        b2c["Invoice Number/CN"] = b2c.apply(
            lambda x: x.get("Credit Note No")
            if str(x.get("Transaction Type")).lower() == "refund"
            else x.get("Invoice Number"),
            axis=1,
        )

        b2c_total_sum = b2c.groupby("Invoice Number/CN")["Invoice Value"].transform("sum")

        b2c_df = pd.DataFrame(
            {
                "Supplier GSTID": b2c.get("Seller Gstin"),
                "Buyer GST": "NA",
                "Buyer Name": "NA",
                "Date": b2c.get("Invoice Date_dt"),
                "Time": "",
                "type": b2c.get("Transaction Type"),
                "Order ID": b2c.get("Order Id"),
                "SKU": b2c.get("Sku"),
                "description": b2c.get("Item Description"),
                "Category": "",
                "Qty": b2c.get("Quantity"),
                "marketplace": "Amazon B2C",
                "order state": b2c.get("order_state_mapped"),
                "Invoice Number/CN": b2c["Invoice Number/CN"],
                "HSN": b2c.get("Hsn/sac"),
                "B2B/B2C": "B2C",
                "Inter/Intra": b2c.get("Inter/Intra"),
                "GST Rate": b2c.get("GST Rate"),
                "product sales": b2c.get("Principal Amount Basis"),
                "shipping credits": "-",
                "promotional rebates": "-",
                "Invoice Total": b2c_total_sum,
                "Invoice Value": b2c.get("Invoice Value"),
                "Tax": b2c.get("Tax"),
                "Taxable Value": b2c.get("Principal Amount Basis"),
                "IGST": b2c.get("IGST"),
                "CGST": b2c.get("CGST"),
                "SGST": b2c.get("SGST"),
                "TCS-IGST": b2c.get("Tcs Igst Amount") if "Tcs Igst Amount" in b2c.columns else None,
                "TCS-CGST": b2c.get("Tcs Cgst Amount") if "Tcs Cgst Amount" in b2c.columns else None,
                "TCS-SGST": b2c.get("Tcs Sgst Amount") if "Tcs Sgst Amount" in b2c.columns else None,
                "TDS": "-",
                "Nature": "-",
                "Period": b2c.get("Period"),
                "E Invoice Status": "NA",
                "E Invoice IRN": "NA",
                "Invoice Status": "-",
                "E way Bill number": "-",
            }
        )

        # ---------- STOCK TRANSFER ----------
        stock = pd.read_csv(stock_path, low_memory=False)

        stock = stock[
            stock.get("Gstin Of Supplier", "").astype(str).str[:2]
            != stock.get("Gstin Of Receiver", "").astype(str).str[:2]
        ].copy()
        stock = stock[stock.get("Transaction Type", "") != "FC_REMOVAL-Cancel"]
        stock["Transaction Type"] = (
            stock.get("Transaction Type", "")
            .astype(str)
            .replace({"FC_REMOVAL": "Order", "FC_TRANSFER": "Order"})
        )

        stock["Ship To State"] = str_col(stock, "Ship To State", "").str.strip().str.upper()
        stock["order_state_mapped"] = map_state_column(stock["Ship To State"])

        for r in rates:
            stock[r] = numeric_col(stock, r, 0)
        stock["GST Rate"] = (stock[rates].sum(axis=1) * 100)
        stock["Taxable Value"] = numeric_col(stock, "Taxable Value", 0)
        stock["Tax"] = (stock["Taxable Value"] * (stock["GST Rate"] / 100)).round(2)
        stock["Invoice Value"] = stock["Taxable Value"] + stock["Tax"]

        stock["Invoice Date_dt"] = pd.to_datetime(stock.get("Invoice Date"), errors="coerce")
        stock["Period"] = stock["Invoice Date_dt"].apply(
            lambda d: f"{calendar.monthrange(d.year, d.month)[1]:02d}-{d.strftime('%b-%Y')}"
            if pd.notnull(d)
            else ""
        )

        stock["Inter/Intra"] = stock.apply(
            lambda x: "Intra"
            if str(x.get("Gstin Of Supplier", ""))[:2] == str(x.get("order_state_mapped", ""))[:2]
            else "Inter",
            axis=1,
        )
        stock["IGST"] = stock.apply(lambda x: x["Tax"] if x["Inter/Intra"] == "Inter" else 0, axis=1).round(2)
        stock["CGST"] = stock.apply(lambda x: x["Tax"] / 2 if x["Inter/Intra"] == "Intra" else 0, axis=1).round(2)
        stock["SGST"] = stock.apply(lambda x: x["Tax"] / 2 if x["Inter/Intra"] == "Intra" else 0, axis=1).round(2)

        invoice_total_sum_stock = stock.groupby("Invoice Number")["Invoice Value"].transform("sum")

        stock_df = pd.DataFrame(
            {
                "Supplier GSTID": stock.get("Gstin Of Supplier"),
                "Buyer GST": stock.get("Gstin Of Receiver"),
                "Buyer Name": "Ecosoul",
                "Date": stock.get("Invoice Date_dt"),
                "Time": "",
                "type": stock.get("Transaction Type"),
                "Order ID": stock.get("Transaction Id"),
                "SKU": stock.get("Sku"),
                "description": "",
                "Category": "",
                "Qty": stock.get("Quantity"),
                "marketplace": "Stock Transfer",
                "order state": stock.get("order_state_mapped"),
                "Invoice Number/CN": stock.get("Invoice Number"),
                "HSN": stock.get("Hsn Code"),
                "B2B/B2C": "Stock Transfer",
                "Inter/Intra": stock.get("Inter/Intra"),
                "GST Rate": stock.get("GST Rate"),
                "product sales": stock.get("Taxable Value"),
                "shipping credits": "-",
                "promotional rebates": "-",
                "Invoice Total": invoice_total_sum_stock,
                "Invoice Value": stock.get("Invoice Value"),
                "Tax": stock.get("Tax"),
                "Taxable Value": stock.get("Taxable Value"),
                "IGST": stock.get("IGST"),
                "CGST": stock.get("CGST"),
                "SGST": stock.get("SGST"),
                "TCS-IGST": "-",
                "TCS-CGST": "-",
                "TCS-SGST": "-",
                "TDS": "-",
                "Nature": "-",
                "Period": stock.get("Period"),
                "E Invoice Status": stock.get("Irn Filing Status")
                if "Irn Filing Status" in stock.columns
                else "NA",
                "E Invoice IRN": stock.get("Irn Number") if "Irn Number" in stock.columns else "NA",
                "Invoice Status": "-",
                "E way Bill number": "-",
            }
        )

        combined = pd.concat([mtr_final, b2c_df, stock_df], ignore_index=True, sort=False)
        combined.to_csv(save_path, index=False)
        return True, f"Saved Amazon combined output to {save_path}. Rows: {combined.shape[0]}"

    except Exception:
        return False, f"Error processing Amazon files:\n{traceback.format_exc()}"


# ------------------------------
# Retail & Export processing
# ------------------------------

def _get_marketplace(customer: str) -> str:
    customer = str(customer).upper()
    if "KIRANAKART TECHNOLOGIES PVT LTD" in customer:
        return "Zepto"
    elif "BLINKIT" in customer:
        return "BLINKIT"
    elif "ECOSOUL HOME INC" in customer:
        return "Export"
    elif "GAUTAM BUDDHA NAGAR(ECOSOUL HOME PRIVATE LIMITED)" in customer:
        return "Branch Transfer"
    elif "AMAZON SELLER SERVICES PVT LTD" in customer:
        return "EHPL Amazon Inventory Transfer"
    elif any(
        name in customer
        for name in [
            "BIRLANU LIMITED",
            "MITSUBISHI ELECTRIC AUTOMOTIVE INDIA PRIVATE LIMITED",
            "SKC GYANYOG EVENTS ASSOCIATION",
            "NILANJAN PAUL",
            "NATIONAL ENGINEERING INDUSTRIES LIMITED",
            "SHYAMLESH KAR",
        ]
    ):
        return "Website/Shopify"
    elif "BIG BASKET" in customer:
        return "BIG BASKET"
    else:
        return "Retail Sale"


def _get_b2b_jio(row):
    if str(row.get("Customer Name", "")).strip().upper() == "ECOSOUL HOME INC":
        return "Export"
    gst = str(row.get("GST Identification Number (GSTIN)", "")).strip()
    if gst == "" or gst.lower() == "nan":
        return "B2C"
    return "B2B"


def process_retail_export(invoice_path, credit_path, save_path):
    """
    Process Retail/Export Invoice and Credit Excel files and save merged output as CSV.
    """
    try:
        # Invoice
        temp_invoice = pd.read_excel(invoice_path, nrows=3, header=None)
        third_row = temp_invoice.iloc[2].astype(str).str.lower().tolist()
        if not any("invoice" in x for x in third_row):
            return False, "Invalid Invoice structure (data must start from 3rd row)."

        invoice = pd.read_excel(invoice_path, header=2)
        invoice = invoice.dropna(how="all").reset_index(drop=True)

        invoice["Customer Name"] = str_col(invoice, "Customer Name", "").str.strip()
        invoice["GST Identification Number (GSTIN)"] = str_col(
            invoice, "GST Identification Number (GSTIN)", ""
        ).str.strip()
        invoice["Place of Supply(With State Code)"] = str_col(
            invoice, "Place of Supply(With State Code)", ""
        ).str.strip()

        invoice["marketplace"] = invoice["Customer Name"].apply(_get_marketplace)
        invoice["type"] = "Order"

        invoice["CGST Rate %"] = numeric_col(invoice, "CGST Rate %", 0)
        invoice["SGST Rate %"] = numeric_col(invoice, "SGST Rate %", 0)
        invoice["IGST Rate %"] = numeric_col(invoice, "IGST Rate %", 0)
        invoice["GST Rate"] = invoice["CGST Rate %"] + invoice["SGST Rate %"] + invoice["IGST Rate %"]

        invoice["Item Price"] = numeric_col(invoice, "Item Price", 0)
        invoice["Quantity"] = numeric_col(invoice, "Quantity", 0)
        invoice["Exchange Rate"] = numeric_col(invoice, "Exchange Rate", 1)
        invoice["Taxable Value"] = (invoice["Item Price"] * invoice["Quantity"] * invoice["Exchange Rate"]).round(
            2
        )

        invoice["Supplier GST Registration Number"] = str_col(
            invoice, "Supplier GST Registration Number", ""
        )
        invoice["Inter/Intra"] = invoice.apply(
            lambda x: "Intra"
            if str(x.get("Supplier GST Registration Number"))[:2]
            == str(x.get("Place of Supply(With State Code)"))[:2]
            else "Inter",
            axis=1,
        )

        invoice["Tax"] = (invoice["Taxable Value"] * invoice["GST Rate"] / 100).round(2)
        invoice["IGST"] = invoice.apply(
            lambda x: x["Tax"] if str(x.get("Inter/Intra", "")).strip().lower() == "inter" else 0,
            axis=1,
        ).round(2)
        invoice["CGST"] = invoice.apply(
            lambda x: x["Tax"] / 2 if str(x.get("Inter/Intra", "")).strip().lower() == "intra" else 0,
            axis=1,
        ).round(2)
        invoice["SGST"] = invoice.apply(
            lambda x: x["Tax"] / 2 if str(x.get("Inter/Intra", "")).strip().lower() == "intra" else 0,
            axis=1,
        ).round(2)
        invoice["Invoice Value"] = invoice["Taxable Value"] + invoice["Tax"]
        invoice_total_sum = invoice.groupby("Invoice Number")["Invoice Value"].transform("sum")
        invoice["Invoice Total"] = invoice_total_sum

        invoice["B2B/B2C"] = invoice.apply(_get_b2b_jio, axis=1)
        invoice["Invoice Date"] = pd.to_datetime(invoice.get("Invoice Date"), errors="coerce")
        invoice["Period"] = invoice["Invoice Date"].apply(
            lambda d: f"{calendar.monthrange(d.year, d.month)[1]:02d}-{d.strftime('%b-%Y')}"
            if pd.notnull(d)
            else ""
        )

        invoice_final = pd.DataFrame(
            {
                "Supplier GSTID": invoice.get("Supplier GST Registration Number"),
                "Buyer GST": invoice.get("GST Identification Number (GSTIN)"),
                "Buyer Name": invoice.get("Customer Name"),
                "Date": invoice.get("Invoice Date"),
                "Time": "",
                "type": invoice.get("type"),
                "Order ID": "",
                "SKU": invoice.get("SKU"),
                "description": invoice.get("Item Name"),
                "Category": "",
                "Qty": invoice.get("Quantity"),
                "marketplace": invoice.get("marketplace"),
                "order state": invoice.get("Place of Supply(With State Code)"),
                "Invoice Number/CN": invoice.get("Invoice Number"),
                "HSN": invoice.get("HSN/SAC"),
                "B2B/B2C": invoice.get("B2B/B2C"),
                "Inter/Intra": invoice.get("Inter/Intra"),
                "GST Rate": invoice.get("GST Rate"),
                "product sales": invoice.get("Taxable Value"),
                "shipping credits": "-",
                "promotional rebates": "-",
                "Invoice Total": invoice.get("Invoice Total"),
                "Invoice Value": invoice.get("Invoice Value"),
                "Tax": invoice.get("Tax"),
                "Taxable Value": invoice.get("Taxable Value"),
                "IGST": invoice.get("IGST"),
                "CGST": invoice.get("CGST"),
                "SGST": invoice.get("SGST"),
                "TCS-IGST": 0,
                "TCS-CGST": 0,
                "TCS-SGST": 0,
                "TDS": "-",
                "Nature": "-",
                "Period": invoice.get("Period"),
                "E Invoice Status": invoice.get("e-Invoice Status")
                if "e-Invoice Status" in invoice.columns
                else None,
                "E Invoice IRN": invoice.get("e-Invoice Reference Number")
                if "e-Invoice Reference Number" in invoice.columns
                else None,
                "Invoice Status": invoice.get("Invoice Status") if "Invoice Status" in invoice.columns else None,
                "E way Bill number": invoice.get("E-WayBill Number")
                if "E-WayBill Number" in invoice.columns
                else None,
            }
        )

        # Credit
        temp_credit = pd.read_excel(credit_path, nrows=1)
        if not any(
            "credit" in str(x).lower() or "note" in str(x).lower() for x in temp_credit.columns
        ):
            return False, "Invalid Credit structure (must include 'Credit Note Number')."

        credit = pd.read_excel(credit_path)

        credit["Customer Name"] = str_col(credit, "Customer Name", "").str.strip()
        credit["GST Identification Number (GSTIN)"] = str_col(
            credit, "GST Identification Number (GSTIN)", ""
        ).str.strip()
        credit["Place of Supply(With State Code)"] = str_col(
            credit, "Place of Supply(With State Code)", ""
        ).str.strip()
        credit["marketplace"] = credit["Customer Name"].apply(_get_marketplace)
        credit["type"] = "Refund"

        credit["CGST Rate %"] = numeric_col(credit, "CGST Rate %", 0)
        credit["SGST Rate %"] = numeric_col(credit, "SGST Rate %", 0)
        credit["IGST Rate %"] = numeric_col(credit, "IGST Rate %", 0)
        credit["GST Rate"] = credit["CGST Rate %"] + credit["SGST Rate %"] + credit["IGST Rate %"]

        credit["Item Price"] = numeric_col(credit, "Item Price", 0)
        credit["Quantity"] = numeric_col(credit, "Quantity", 0)
        credit["Exchange Rate"] = numeric_col(credit, "Exchange Rate", 1)

        credit["Item Price"] = credit["Item Price"] * -1
        credit["Taxable Value"] = (
            credit["Item Price"] * credit["Quantity"] * credit["Exchange Rate"]
        ).round(2)

        credit["Supplier GST Registration Number"] = str_col(
            credit, "Supplier GST Registration Number", ""
        )
        credit["Inter/Intra"] = credit.apply(
            lambda x: "Intra"
            if str(x.get("Supplier GST Registration Number"))[:2]
            == str(x.get("Place of Supply(With State Code)"))[:2]
            else "Inter",
            axis=1,
        )

        credit["Tax"] = (credit["Taxable Value"] * credit["GST Rate"] / 100).round(2)
        credit["IGST"] = credit.apply(
            lambda x: x["Tax"] if str(x.get("Inter/Intra", "")).strip().lower() == "inter" else 0,
            axis=1,
        ).round(2)
        credit["CGST"] = credit.apply(
            lambda x: x["Tax"] / 2 if str(x.get("Inter/Intra", "")).strip().lower() == "intra" else 0,
            axis=1,
        ).round(2)
        credit["SGST"] = credit.apply(
            lambda x: x["Tax"] / 2 if str(x.get("Inter/Intra", "")).strip().lower() == "intra" else 0,
            axis=1,
        ).round(2)
        credit["Invoice Value"] = credit["Taxable Value"] + credit["Tax"]

        credit_total_sum = credit.groupby("Credit Note Number")["Invoice Value"].transform("sum")
        credit["Invoice Total"] = credit_total_sum
        credit["B2B/B2C"] = credit.apply(_get_b2b_jio, axis=1)

        credit["Invoice Date"] = pd.to_datetime(credit.get("Credit Note Date"), errors="coerce")
        credit["Period"] = credit["Invoice Date"].apply(
            lambda d: f"{calendar.monthrange(d.year, d.month)[1]:02d}-{d.strftime('%b-%Y')}"
            if pd.notnull(d)
            else ""
        )

        credit_final = pd.DataFrame(
            {
                "Supplier GSTID": credit.get("Supplier GST Registration Number"),
                "Buyer GST": credit.get("GST Identification Number (GSTIN)"),
                "Buyer Name": credit.get("Customer Name"),
                "Date": credit.get("Invoice Date"),
                "Time": "",
                "type": credit.get("type"),
                "Order ID": "",
                "SKU": credit.get("SKU"),
                "description": credit.get("Item Name"),
                "Category": "",
                "Qty": credit.get("Quantity"),
                "marketplace": credit.get("marketplace"),
                "order state": credit.get("Place of Supply(With State Code)"),
                "Invoice Number/CN": credit.get("Credit Note Number"),
                "HSN": credit.get("HSN/SAC"),
                "B2B/B2C": credit.get("B2B/B2C"),
                "Inter/Intra": credit.get("Inter/Intra"),
                "GST Rate": credit.get("GST Rate"),
                "product sales": credit.get("Taxable Value"),
                "shipping credits": "-",
                "promotional rebates": "-",
                "Invoice Total": credit.get("Invoice Total"),
                "Invoice Value": credit.get("Invoice Value"),
                "Tax": credit.get("Tax"),
                "Taxable Value": credit.get("Taxable Value"),
                "IGST": credit.get("IGST"),
                "CGST": credit.get("CGST"),
                "SGST": credit.get("SGST"),
                "TCS-IGST": 0,
                "TCS-CGST": 0,
                "TCS-SGST": 0,
                "TDS": "-",
                "Nature": "-",
                "Period": credit.get("Period"),
                "E Invoice Status": credit.get("e-Invoice Status")
                if "e-Invoice Status" in credit.columns
                else None,
                "E Invoice IRN": credit.get("e-Invoice Reference Number")
                if "e-Invoice Reference Number" in credit.columns
                else None,
                "Invoice Status": credit.get("Credit Note Status")
                if "Credit Note Status" in credit.columns
                else None,
                "E way Bill number": credit.get("E-WayBill Number")
                if "E-WayBill Number" in credit.columns
                else None,
            }
        )

        combined = pd.concat([invoice_final, credit_final], ignore_index=True, sort=False)
        combined.to_csv(save_path, index=False)
        return True, f"Saved Retail/Export combined output to {save_path}. Rows: {combined.shape[0]}"

    except Exception:
        return False, f"Error processing Retail/Export files:\n{traceback.format_exc()}"


# ------------------------------
# Jio processing
# ------------------------------

def process_jio_file(jio_path, save_path):
    """
    Process a Jio CSV file and save to save_path.
    """
    try:
        jio = pd.read_csv(jio_path, low_memory=False)
        if jio.shape[0] == 0:
            return False, "Empty Jio file."

        if "Type" in jio.columns:
            jio["Type"] = (
                jio["Type"]
                .astype(str)
                .str.strip()
                .str.title()
                .replace({"Shipment": "Order", "return": "Refund", "Return": "Refund"})
            )

        jio["Customer's Delivery State"] = str_col(
            jio, "Customer's Delivery State", ""
        ).str.strip().str.upper()
        jio["order_state_mapped"] = map_state_column(jio["Customer's Delivery State"])

        columns_for_jio_rates = [
            "CGST Rate",
            "SGST Rate (or UTGST as applicable)",
            "IGST Rate",
        ]
        for c in columns_for_jio_rates:
            if c not in jio.columns:
                jio[c] = 0
        jio["GST Rate"] = jio[columns_for_jio_rates].fillna(0).sum(axis=1).round(2)

        base_col = "Taxable Value (Final Invoice Amount -Taxes)"
        jio[base_col] = numeric_col(jio, base_col, 0)
        jio["Tax"] = (jio[base_col] * (jio["GST Rate"] / 100)).round(2)
        jio["Invoice Value"] = jio[base_col] + jio["Tax"]

        jio["Invoice Date"] = pd.to_datetime(jio.get("Buyer Invoice Date"), errors="coerce")
        jio["Period"] = jio["Invoice Date"].apply(
            lambda d: f"{calendar.monthrange(d.year, d.month)[1]:02d}-{d.strftime('%b-%Y')}"
            if pd.notnull(d)
            else ""
        )

        jio["Inter/Intra"] = jio.apply(
            lambda x: "Intra"
            if str(x.get("Seller GSTIN", ""))[:2] == str(x.get("order_state_mapped", ""))[:2]
            else "Inter",
            axis=1,
        )
        jio["IGST"] = jio.apply(lambda x: x["Tax"] if x["Inter/Intra"] == "Inter" else 0, axis=1).round(2)
        jio["CGST"] = jio.apply(lambda x: x["Tax"] / 2 if x["Inter/Intra"] == "Intra" else 0, axis=1).round(2)
        jio["SGST"] = jio.apply(lambda x: x["Tax"] / 2 if x["Inter/Intra"] == "Intra" else 0, axis=1).round(2)

        invoice_total_sum = jio.groupby("Buyer Invoice ID")["Invoice Value"].transform("sum")

        jio_df = pd.DataFrame(
            {
                "Supplier GSTID": jio.get("Seller GSTIN"),
                "Buyer GST": "NA",
                "Buyer Name": "NA",
                "Date": jio.get("Invoice Date"),
                "Time": "",
                "type": jio.get("Type"),
                "Order ID": jio.get("Order ID"),
                "SKU": jio.get("SKU"),
                "description": jio.get("Product Title/Description"),
                "Category": "",
                "Qty": jio.get("Item Quantity"),
                "marketplace": "JioMart",
                "order state": jio.get("order_state_mapped"),
                "Invoice Number/CN": jio.get("Buyer Invoice ID"),
                "HSN": jio.get("HSN Code"),
                "B2B/B2C": "Jio",
                "Inter/Intra": jio.get("Inter/Intra"),
                "GST Rate": jio.get("GST Rate"),
                "product sales": jio.get(base_col),
                "shipping credits": "-",
                "promotional rebates": "-",
                "Invoice Total": invoice_total_sum,
                "Invoice Value": jio.get("Invoice Value"),
                "Tax": jio.get("Tax"),
                "Taxable Value": jio.get(base_col),
                "IGST": jio.get("IGST"),
                "CGST": jio.get("CGST"),
                "SGST": jio.get("SGST"),
                "TCS-IGST": jio.get("TCS IGST Amount") if "TCS IGST Amount" in jio.columns else None,
                "TCS-CGST": jio.get("TCS CGST Amount") if "TCS CGST Amount" in jio.columns else None,
                "TCS-SGST": jio.get("TCS SGST Amount") if "TCS SGST Amount" in jio.columns else None,
                "TDS": jio.get("TDS 194O Amount") if "TDS 194O Amount" in jio.columns else None,
                "Nature": "-",
                "Period": jio.get("Period"),
                "E Invoice Status": "NA",
                "E Invoice IRN": "NA",
                "Invoice Status": "-",
                "E way Bill number": "-",
            }
        )

        jio_df.to_csv(save_path, index=False)
        return True, f"Saved Jio output to {save_path}. Rows: {jio_df.shape[0]}"

    except Exception:
        return False, f"Error processing Jio file:\n{traceback.format_exc()}"


# ------------------------------
# Generic merge
# ------------------------------

def merge_files(filepaths, save_path):
    """
    Merge (append) any number of files (csv or excel) and save as CSV.
    """
    try:
        frames = []
        for p in filepaths:
            ext = os.path.splitext(p)[1].lower()
            if ext == ".csv":
                df = pd.read_csv(p, low_memory=False)
            elif ext in [".xls", ".xlsx"]:
                df = pd.read_excel(p, sheet_name=0)
            else:
                df = pd.read_csv(p, low_memory=False)
            frames.append(df)

        if not frames:
            return False, "No files provided to merge."

        merged = pd.concat(frames, ignore_index=True, sort=False)
        merged.to_csv(save_path, index=False)
        return True, f"Merged {len(frames)} files and saved to {save_path}. Rows: {merged.shape[0]}"

    except Exception:
        return False, f"Error merging files:\n{traceback.format_exc()}"


# ------------------------------
# CLI wrapper
# ------------------------------

def _default_glob_first(pattern):
    matches = sorted(glob.glob(pattern))
    return matches[0] if matches else None


def main():
    parser = argparse.ArgumentParser(description="GST Reconcile processor")
    parser.add_argument("--mode", choices=["amazon", "retail", "jio", "merge"], required=True, help="Processing mode")
    parser.add_argument("--mtr", help="Path to Amazon MTR B2B CSV")
    parser.add_argument("--b2c", help="Path to Amazon B2C CSV")
    parser.add_argument("--stock", help="Path to Amazon stock transfer CSV")
    parser.add_argument("--invoice", help="Path to Retail/Export invoice Excel")
    parser.add_argument("--credit", help="Path to Retail/Export credit Excel")
    parser.add_argument("--jio", help="Path to Jio CSV")
    parser.add_argument("--files", nargs="+", help="Files to merge (CSV/Excel)")
    parser.add_argument("--output", required=True, help="Output CSV path")

    args = parser.parse_args()
    mode = args.mode.lower()

    if mode == "amazon":
        mtr_path = args.mtr or _default_glob_first(os.path.join(os.getcwd(), "MTR_B2B-*.csv"))
        b2c_path = args.b2c or _default_glob_first(os.path.join(os.getcwd(), "MTR_B2C-*.csv"))
        stock_path = args.stock or _default_glob_first(os.path.join(os.getcwd(), "MTR_STOCK_TRANSFER-*.csv"))

        if not all([mtr_path, b2c_path, stock_path]):
            print("Missing one of: MTR, B2C, Stock files.")
            return 1

        ok, msg = process_amazon_files(mtr_path, b2c_path, stock_path, args.output)

    elif mode == "retail":
        invoice_path = args.invoice or _default_glob_first(os.path.join(os.getcwd(), "Retail_invoice_input*.xlsx"))
        credit_path = args.credit or _default_glob_first(os.path.join(os.getcwd(), "Retail_credit_input*.xlsx"))

        if not all([invoice_path, credit_path]):
            print("Missing Invoice or Credit file.")
            return 1

        ok, msg = process_retail_export(invoice_path, credit_path, args.output)

    elif mode == "jio":
        jio_path = args.jio or _default_glob_first(os.path.join(os.getcwd(), "Jio_*.csv"))
        if not jio_path:
            print("Missing Jio file.")
            return 1
        ok, msg = process_jio_file(jio_path, args.output)

    else:  # merge
        if not args.files:
            print("No files provided to merge.")
            return 1
        ok, msg = merge_files(args.files, args.output)

    print(msg)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

