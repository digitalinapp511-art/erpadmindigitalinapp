#!/usr/bin/env python3
"""
Combined GST and Bookkeeping Reconciliation Script
===================================================
Combines GST file processing, bookkeeping file processing, and reconciliation logic
into a single script.

Usage (CLI):
    python combined_gst_book_reconcile.py \
        --gst-input "path/to/gst_file_or_folder" \
        --books-input "path/to/bookkeeping_file_or_folder" \
        --output "reconciled_output.csv"
"""

from __future__ import annotations

import argparse
import sys
import traceback
from pathlib import Path
from typing import Iterable, List, Tuple

import numpy as np
import pandas as pd


# =============================================================================
# GST PROCESSING CONSTANTS
# =============================================================================

GST_REQUIRED_COLUMNS = [
    "GSTIN_of_supplier_Unnamed:_0_level_1",
    "Trade/Legal name_Unnamed:_1_level_1",
    "Invoice_Details_Invoice_number",
    "Invoice_Details_Invoice_Date",
    "Invoice_Details_Invoice_Value",
    "Place_of_supply_Unnamed:_6_level_1",
    "Supply Attract Reverse Charge_Unnamed:_7_level_1",
    "Taxable_Value_Unnamed:_8_level_1",
    "Tax_Amount_Integrated_Tax",
    "Tax_Amount_Central_Tax",
    "Tax_Amount_State/UT_Tax",
    "Tax_Amount_Cess",
    "GSTR-1/1A/IFF/GSTR-5_Filing_Date_Unnamed:_14_level_1",
]

GST_RENAME_COLUMNS = {
    "GSTIN_of_supplier_Unnamed:_0_level_1": "GSTIN_of_supplier",
    "Trade/Legal name_Unnamed:_1_level_1": "trade_legal_name",
    "Invoice_Details_Invoice_number": "invoice_number",
    "Invoice_Details_Invoice_Date": "invoice_date",
    "Invoice_Details_Invoice_Value": "invoice_value",
    "Place_of_supply_Unnamed:_6_level_1": "place_of_supply",
    "Supply Attract Reverse Charge_Unnamed:_7_level_1": "supply_attract_reverse_charge",
    "Taxable_Value_Unnamed:_8_level_1": "taxable_value",
    "Tax_Amount_Integrated_Tax": "integrated_tax",
    "Tax_Amount_Central_Tax": "central_tax",
    "Tax_Amount_State/UT_Tax": "state_tax",
    "Tax_Amount_Cess": "cess",
    "GSTR-1/1A/IFF/GSTR-5_Filing_Date_Unnamed:_14_level_1": "filing_date",
}


# =============================================================================
# BOOKKEEPING PROCESSING CONSTANTS
# =============================================================================

BOOKKEEPING_USE_COLUMNS = [
    "Bill Date",
    "Vendor Name",
    "Bill Number",
    "Account",
    "Branch Name",
    "SubTotal",
    "Total",
    "Item Total",
    "IGST",
    "SGST",
    "CGST",
    "CESS",
    "Adjustment",
    "Tax Percentage",
    "GST Identification Number (GSTIN)",
    "Branch ID",
    "Source of Supply",
]

BOOKKEEPING_RENAME_COLUMNS = {
    "Bill Date": "bill_date",
    "Vendor Name": "vendor_name",
    "Bill Number": "bill_number",
    "Account": "account_type",
    "Branch Name": "branch_name",
    "SubTotal": "amount_without_tax",
    "Total": "taxable_value",
    "Item Total": "item_total",
    "IGST": "integrated_tax",
    "SGST": "state_tax",
    "CGST": "central_tax",
    "CESS": "cess",
    "Adjustment": "adjustment",
    "Tax Percentage": "tax_percentage",
    "GST Identification Number (GSTIN)": "GSTIN_of_supplier",
    "Branch ID": "branch_id",
    "Source of Supply": "place_of_supply",
}


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================


def _print_header(title: str) -> None:
    """Print a formatted header."""
    bar = "=" * 60
    print(f"\n{bar}\n{title}\n{bar}")


def _flatten_columns(columns: Iterable[Tuple]) -> List[str]:
    """
    Flatten MultiIndex columns by joining non-empty parts with "_"
    and applying basic cleaning.
    """
    flattened = [
        "_".join([str(c).strip() for c in col if pd.notna(c) and c != ""])
        for col in columns
    ]
    cleaned = (
        pd.Index(flattened)
        .str.replace(" ", "_")
        .str.replace("(₹)", "", regex=False)
        .str.replace("__", "_")
        .str.strip("_")
        .tolist()
    )
    return cleaned


def _find_column_mapping(actual_columns: List[str], expected_columns: List[str]) -> dict:
    """
    Map expected column names to actual column names using flexible matching.
    Returns a dictionary mapping expected -> actual column names.
    """
    mapping = {}
    actual_lower = [c.lower() for c in actual_columns]

    # Define key terms for each expected column (for better matching)
    column_keywords = {
        "GSTIN_of_supplier_Unnamed:_0_level_1": ["gstin", "supplier"],
        "Trade/Legal name_Unnamed:_1_level_1": ["trade", "legal", "name"],
        "Invoice_Details_Invoice_number": ["invoice", "number"],
        "Invoice_Details_Invoice_Date": ["invoice", "date"],
        "Invoice_Details_Invoice_Value": ["invoice", "value"],
        "Place_of_supply_Unnamed:_6_level_1": ["place", "supply"],
        "Supply Attract Reverse Charge_Unnamed:_7_level_1": [
            "supply",
            "attract",
            "reverse",
            "charge",
        ],
        "Taxable_Value_Unnamed:_8_level_1": ["taxable", "value"],
        "Tax_Amount_Integrated_Tax": ["integrated", "tax"],
        "Tax_Amount_Central_Tax": ["central", "tax"],
        "Tax_Amount_State/UT_Tax": ["state", "ut", "tax"],
        "Tax_Amount_Cess": ["cess"],
        "GSTR-1/1A/IFF/GSTR-5_Filing_Date_Unnamed:_14_level_1": [
            "filing",
            "date",
            "gstr",
        ],
    }

    for expected in expected_columns:
        # Try exact match first
        if expected in actual_columns:
            mapping[expected] = expected
            continue

        # Try case-insensitive exact match
        expected_lower = expected.lower()
        if expected_lower in actual_lower:
            idx = actual_lower.index(expected_lower)
            mapping[expected] = actual_columns[idx]
            continue

        # Try partial matching using keywords
        keywords = column_keywords.get(expected, [])
        if not keywords:
            # Fallback: extract key parts from expected column name
            key_parts = expected.split("_Unnamed:")[0].lower()
            key_parts = key_parts.replace("/", "_").replace("-", "_").split("_")
            keywords = [
                p
                for p in key_parts
                if p and p not in ["unnamed", "level", "details", "amount"]
            ]

        best_match = None
        best_score = 0

        for actual in actual_columns:
            actual_lower_clean = actual.lower().replace("/", "_").replace("-", "_")

            # Count how many keywords are found in the actual column name
            matches = sum(1 for keyword in keywords if keyword in actual_lower_clean)

            # Require at least 50% of keywords to match, or all if there are only 1–2
            min_required = (
                max(1, int(len(keywords) * 0.5)) if len(keywords) > 2 else len(keywords)
            )

            if matches >= min_required and matches > best_score:
                best_score = matches
                best_match = actual

        if best_match:
            mapping[expected] = best_match
            print(f"    ✓ Matched '{expected}' -> '{best_match}'")
        else:
            # If no match found, raise error with helpful message
            preview = (
                f"{actual_columns[:15]}..."
                if len(actual_columns) > 15
                else f"{actual_columns}"
            )
            raise ValueError(
                f"Could not find column matching '{expected}'. "
                f"Looking for keywords: {keywords}. "
                f"Available columns: {preview}"
            )

    return mapping


def _collect_files(input_path: Path, extensions: List[str]) -> List[Path]:
    """
    Collect files from a file or directory.
    """
    if input_path.is_file():
        return [input_path]

    found: List[Path] = []
    if input_path.is_dir():
        for ext in extensions:
            found.extend(list(input_path.glob(f"*{ext}")))
            found.extend(list(input_path.glob(f"**/*{ext}")))  # Recursive search
    # Remove duplicates
    return sorted({p.resolve() for p in found})


# =============================================================================
# GST PROCESSING FUNCTIONS
# =============================================================================


def _load_and_clean_gst(path: Path, sheet_name: str = "B2B") -> pd.DataFrame:
    """
    Load a raw GST Excel file, flatten columns, select required columns, and rename.
    """
    df_raw = pd.read_excel(path, sheet_name=sheet_name, skiprows=4, header=[0, 1])
    df_raw.columns = _flatten_columns(df_raw.columns)

    # Debug: Print actual columns found
    print(f"    📋 Found {len(df_raw.columns)} columns")
    if len(df_raw.columns) <= 20:
        print(f"    Columns: {list(df_raw.columns)}")
    else:
        print(f"    First 10 columns: {list(df_raw.columns[:10])}")

    # Use flexible column matching
    try:
        column_mapping = _find_column_mapping(list(df_raw.columns), GST_REQUIRED_COLUMNS)
    except ValueError as e:
        raise ValueError(f"Column matching failed: {e}")

    # Select columns using the mapping
    actual_required_columns = [column_mapping[req] for req in GST_REQUIRED_COLUMNS]
    df = df_raw[actual_required_columns].copy()

    # Create rename mapping: expected -> clean name
    rename_map = {}
    for expected, clean_name in GST_RENAME_COLUMNS.items():
        actual_col = column_mapping[expected]
        rename_map[actual_col] = clean_name

    df = df.rename(columns=rename_map)

    # Derive year_month from invoice_date
    df["invoice_date"] = pd.to_datetime(df["invoice_date"], errors="coerce", dayfirst=True)
    df["year_month"] = df["invoice_date"].dt.strftime("%Y-%m")
    df["source_file"] = path.name
    return df


def _load_cleaned_gst_file(path: Path) -> pd.DataFrame:
    """
    Load an already-cleaned GST file (output of gst_file_processing).
    Accepts CSV or Excel with flat headers and standard column names.
    """
    ext = path.suffix.lower()
    if ext in {".xlsx", ".xls"}:
        df = pd.read_excel(path)
    else:
        df = pd.read_csv(path)

    # Ensure invoice_date and year_month exist
    if "invoice_date" in df.columns:
        df["invoice_date"] = pd.to_datetime(df["invoice_date"], errors="coerce", dayfirst=True)
        if "year_month" not in df.columns:
            df["year_month"] = df["invoice_date"].dt.strftime("%Y-%m")

    df["source_file"] = path.name
    return df


def _get_excel_sheet_names(path: Path) -> List[str]:
    """Return list of worksheet names in an Excel file."""
    with pd.ExcelFile(path) as xl:
        return xl.sheet_names


def _is_sheet_not_found_error(e: Exception) -> bool:
    """True if the exception indicates the requested worksheet name was not found."""
    msg = str(e).lower()
    return "not found" in msg and ("worksheet" in msg or "sheet" in msg)


def _load_gst_from_file(path: Path, preferred_sheet: str = "B2B") -> pd.DataFrame:
    """
    Load GST data from an Excel file. Tries preferred_sheet (e.g. 'B2B') first;
    if that sheet is missing, tries each available sheet until one has valid GST structure.
    """
    try:
        return _load_and_clean_gst(path, sheet_name=preferred_sheet)
    except Exception as e:
        if not _is_sheet_not_found_error(e):
            raise

    sheet_names = _get_excel_sheet_names(path)
    if not sheet_names:
        raise ValueError(f"No worksheets found in {path.name}")

    for name in sheet_names:
        if name == preferred_sheet:
            continue
        try:
            print(f"    Trying sheet: '{name}' (B2B not found)")
            df = _load_and_clean_gst(path, sheet_name=name)
            print(f"    ✓ Using sheet: '{name}'")
            return df
        except (ValueError, KeyError, Exception):
            continue

    raise ValueError(
        f"No worksheet with valid GST B2B structure found. "
        f"Available sheets: {sheet_names}. Expected a sheet (e.g. 'B2B') with GST invoice columns."
    )


def process_gst_files(
    input_path: str,
    sheet_name: str = "B2B",
    use_cleaned: bool = False,
) -> pd.DataFrame:
    """
    Process GST files and return combined DataFrame.

    Args:
        input_path: Path to GST file or folder.
        sheet_name: Sheet name for raw Excel files (default 'B2B').
        use_cleaned: If True, treat input as already-cleaned GST (CSV/Excel).
    """
    inp = Path(input_path).expanduser().resolve()
    extensions = [".xlsx", ".xls", ".csv"] if use_cleaned else [".xlsx", ".xls"]
    files = _collect_files(inp, extensions)

    if not files:
        raise FileNotFoundError(f"No Excel files found at {inp}")

    frames: List[pd.DataFrame] = []
    for f in files:
        try:
            print(f"  → Processing GST file: {f.name}")
            if use_cleaned:
                frames.append(_load_cleaned_gst_file(f))
            else:
                frames.append(_load_gst_from_file(f, preferred_sheet=sheet_name))
        except Exception as e:
            print(f"  ✗ Skipped {f.name}: {e}")
            continue

    if not frames:
        raise RuntimeError("No GST files processed successfully.")

    combined = pd.concat(frames, ignore_index=True, sort=False)
    combined = combined.drop_duplicates()  # Remove duplicates
    print("\n✅ GST Processing Complete")
    print(f"   Files processed: {len(frames)}")
    print(f"   Total rows     : {combined.shape[0]} (after removing duplicates)")
    return combined


# =============================================================================
# BOOKKEEPING PROCESSING FUNCTIONS
# =============================================================================


def _load_and_clean_bookkeeping(path: Path) -> pd.DataFrame:
    """
    Load a Book Keeping CSV/Excel file, select required columns, rename, and clean data.
    """
    # Read CSV/Excel with bill_number as object (string) to preserve numbers as text
    dtype_dict = {"Bill Number": str}
    ext = path.suffix.lower()

    try:
        if ext in [".xlsx", ".xls"]:
            df_raw = pd.read_excel(path, usecols=BOOKKEEPING_USE_COLUMNS, dtype=dtype_dict)
        else:
            df_raw = pd.read_csv(path, usecols=BOOKKEEPING_USE_COLUMNS, dtype=dtype_dict)
    except KeyError as e:
        # If some columns are missing, try to read all and check what's available
        if ext in [".xlsx", ".xls"]:
            df_all = pd.read_excel(path)
        else:
            df_all = pd.read_csv(path)
        missing = [c for c in BOOKKEEPING_USE_COLUMNS if c not in df_all.columns]
        raise ValueError(f"Missing required columns: {missing}") from e

    df = df_raw.copy()
    df = df.rename(columns=BOOKKEEPING_RENAME_COLUMNS)

    # Derive year_month from bill_date
    df["bill_date"] = pd.to_datetime(df["bill_date"], errors="coerce", dayfirst=True)
    df["year_month"] = df["bill_date"].dt.strftime("%Y-%m")

    # Convert branch_id to text (string)
    df["branch_id"] = df["branch_id"].astype(str)

    # Fill NA with 0 for amount_without_tax and round to 2 decimal places
    df["amount_without_tax"] = df["amount_without_tax"].fillna(0).round(2)

    # Fill NA with 0 and ensure 2 decimal places for specific tax/adjustment columns
    decimal_cols = [
        "integrated_tax",
        "state_tax",
        "central_tax",
        "adjustment",
        "taxable_value",
        "cess",
        "item_total",
        "tax_percentage",
        "amount_without_tax",
    ]
    for col in decimal_cols:
        df[col] = df[col].fillna(0).round(2).astype(float)

    # Fill NA with "Not available" for GSTIN_of_supplier
    df["GSTIN_of_supplier"] = df["GSTIN_of_supplier"].fillna("Not available")

    df["source_file"] = path.name
    return df


def _load_cleaned_bookkeeping_file(path: Path) -> pd.DataFrame:
    """
    Load an already-cleaned bookkeeping file (output of book_keeping_file_processing).
    Accepts CSV or Excel with flat headers and standard column names.
    """
    ext = path.suffix.lower()
    if ext in {".xlsx", ".xls"}:
        df = pd.read_excel(path)
    else:
        df = pd.read_csv(path)

    if "bill_number" in df.columns:
        df["bill_number"] = df["bill_number"].astype(str)
    if "bill_date" in df.columns and "year_month" not in df.columns:
        df["bill_date"] = pd.to_datetime(df["bill_date"], errors="coerce", dayfirst=True)
        df["year_month"] = df["bill_date"].dt.strftime("%Y-%m")

    df["source_file"] = path.name
    return df


def process_bookkeeping_files(input_path: str, use_cleaned: bool = False) -> pd.DataFrame:
    """
    Process bookkeeping files and return combined DataFrame.

    Args:
        input_path: Path to bookkeeping file or folder.
        use_cleaned: If True, treat input as already-cleaned books (CSV/Excel).
    """
    inp = Path(input_path).expanduser().resolve()
    files = _collect_files(inp, [".csv", ".xlsx", ".xls"])

    if not files:
        raise FileNotFoundError(f"No CSV/Excel files found at {inp}")

    frames: List[pd.DataFrame] = []
    for f in files:
        try:
            print(f"  → Processing bookkeeping file: {f.name}")
            if use_cleaned:
                frames.append(_load_cleaned_bookkeeping_file(f))
            else:
                frames.append(_load_and_clean_bookkeeping(f))
        except Exception as e:
            print(f"  ✗ Skipped {f.name}: {e}")
            continue

    if not frames:
        raise RuntimeError("No bookkeeping files processed successfully.")

    combined = pd.concat(frames, ignore_index=True, sort=False)
    print("\n✅ Bookkeeping Processing Complete")
    print(f"   Files processed: {len(frames)}")
    print(f"   Total rows     : {combined.shape[0]}")
    return combined


# =============================================================================
# RECONCILIATION FUNCTIONS
# =============================================================================


def prepare_gst_data(gst_df: pd.DataFrame) -> pd.DataFrame:
    """
    Prepare GST data by grouping and aggregating.
    """
    prefix = "gst_"
    gst_df = gst_df.copy()
    gst_df.columns = [prefix + col for col in gst_df.columns]

    gst_data_main = (
        gst_df.groupby(["gst_year_month", "gst_GSTIN_of_supplier"])[
            [
                "gst_invoice_value",
                "gst_taxable_value",
                "gst_integrated_tax",
                "gst_central_tax",
                "gst_state_tax",
                "gst_cess",
            ]
        ]
        .sum()
        .reset_index()
    )

    return gst_data_main


def prepare_bookkeeping_data(books_df: pd.DataFrame) -> pd.DataFrame:
    """
    Prepare bookkeeping data by grouping and aggregating.
    """
    prefix = "books_"
    books_df = books_df.copy()
    books_df.columns = [prefix + col for col in books_df.columns]

    books_required = (
        books_df.groupby(["books_year_month", "books_GSTIN_of_supplier"])[
            [
                "books_item_total",
                "books_integrated_tax",
                "books_central_tax",
                "books_state_tax",
                "books_cess",
            ]
        ]
        .sum()
        .reset_index()
    )

    books_required["books_invoice_value"] = (
        books_required["books_item_total"]
        + books_required["books_integrated_tax"]
        + books_required["books_central_tax"]
        + books_required["books_state_tax"]
        + books_required["books_cess"]
    )

    return books_required


def reconcile_data(gst_data_main: pd.DataFrame, books_required: pd.DataFrame) -> pd.DataFrame:
    """
    Merge GST and bookkeeping data and calculate differences.
    """
    merged_data = (
        gst_data_main.merge(
            books_required,
            left_on=["gst_year_month", "gst_GSTIN_of_supplier"],
            right_on=["books_year_month", "books_GSTIN_of_supplier"],
            how="outer",
        )
        .fillna("NA")
    )

    # Create match flag
    merged_data["Match_Flag"] = np.where(
        merged_data.gst_GSTIN_of_supplier == merged_data.books_GSTIN_of_supplier,
        "GST Match",
        "No GST Match",
    )

    # Convert columns to numeric
    cols_to_convert = [
        "gst_invoice_value",
        "books_invoice_value",
        "gst_taxable_value",
        "books_item_total",
        "gst_integrated_tax",
        "books_integrated_tax",
        "gst_central_tax",
        "books_central_tax",
        "gst_state_tax",
        "books_state_tax",
        "gst_cess",
        "books_cess",
    ]

    for col in cols_to_convert:
        merged_data[col] = (
            merged_data[col]
            .astype(str)
            .str.replace(",", "")
            .str.strip()
            .replace("", "0")
        )
        merged_data[col] = pd.to_numeric(merged_data[col], errors="coerce").fillna(0)

    # Calculate differences
    same_gst = merged_data["Match_Flag"] == "GST Match"

    merged_data["invoice_value_difference"] = np.where(
        same_gst,
        merged_data["gst_invoice_value"] - merged_data["books_invoice_value"],
        0,
    )
    merged_data["item_value_difference"] = np.where(
        same_gst,
        merged_data["gst_taxable_value"] - merged_data["books_item_total"],
        0,
    )
    merged_data["integrated_tax_difference"] = np.where(
        same_gst,
        merged_data["gst_integrated_tax"] - merged_data["books_integrated_tax"],
        0,
    )
    merged_data["Central_tax_difference"] = np.where(
        same_gst,
        merged_data["gst_central_tax"] - merged_data["books_central_tax"],
        0,
    )
    merged_data["state_tax_difference"] = np.where(
        same_gst,
        merged_data["gst_state_tax"] - merged_data["books_state_tax"],
        0,
    )
    merged_data["cess_difference"] = np.where(
        same_gst,
        merged_data["gst_cess"] - merged_data["books_cess"],
        0,
    )

    return merged_data


# =============================================================================
# MAIN EXECUTION
# =============================================================================


def run_reconciliation(
    gst_input: str,
    books_input: str,
    output_path: Path,
    gst_mode: str = "raw",
    books_mode: str = "raw",
) -> Path:
    """
    Run full reconciliation pipeline and save to output_path.

    Args:
        gst_input: Path to GST file or folder (raw Excel or cleaned CSV/Excel).
        books_input: Path to bookkeeping file or folder (raw or cleaned CSV/Excel).
        output_path: Where to save reconciled output (CSV/Excel).
        gst_mode: "raw" if gst_input is raw B2B Excel, "clean" if already cleaned.
        books_mode: "raw" if books_input is raw Zoho Books export, "clean" if already cleaned.

    Returns the resolved output_path.
    """
    _print_header("GST vs BOOKKEEPING RECONCILIATION")

    # Step 1: GST processing
    print("\n" + "=" * 60)
    print("STEP 1: GST File Processing")
    print("=" * 60)
    print(f"Input path: {gst_input} (mode: {gst_mode})")
    use_cleaned_gst = gst_mode.lower() == "clean"
    gst_df = process_gst_files(gst_input, use_cleaned=use_cleaned_gst)

    # Step 2: Bookkeeping processing
    print("\n" + "=" * 60)
    print("STEP 2: Bookkeeping File Processing")
    print("=" * 60)
    print(f"Input path: {books_input} (mode: {books_mode})")
    use_cleaned_books = books_mode.lower() == "clean"
    books_df = process_bookkeeping_files(books_input, use_cleaned=use_cleaned_books)

    # Step 3: Prepare data
    print("\n" + "=" * 60)
    print("STEP 3: Preparing Data for Reconciliation")
    print("=" * 60)
    print("  → Preparing GST data...")
    gst_data_main = prepare_gst_data(gst_df)
    print(f"     GST records: {len(gst_data_main)}")

    print("  → Preparing bookkeeping data...")
    books_required = prepare_bookkeeping_data(books_df)
    print(f"     Bookkeeping records: {len(books_required)}")

    # Step 4: Reconcile
    print("\n" + "=" * 60)
    print("STEP 4: Reconciliation")
    print("=" * 60)
    print("  → Merging and calculating differences...")
    merged_data = reconcile_data(gst_data_main, books_required)
    print(f"     Merged records: {len(merged_data)}")

    # Step 5: Save output
    print("\n" + "=" * 60)
    print("STEP 5: Saving Output")
    print("=" * 60)

    output_path = output_path.expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    ext = output_path.suffix.lower()
    if ext in {".xlsx", ".xls"}:
        merged_data.to_excel(output_path, index=False)
    else:
        merged_data.to_csv(output_path, index=False)

    print("\n✅ Reconciliation Complete!")
    print(f"   Output saved to: {output_path}")
    print(f"   Total records  : {len(merged_data)}")
    print(
        f"   Matched records: "
        f"{len(merged_data[merged_data['Match_Flag'] == 'GST Match'])}"
    )

    return output_path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Combined GST and Bookkeeping Reconciliation",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python combined_gst_book_reconcile.py \\
    --gst-input "C:/path/to/gst_file_or_folder" \\
    --books-input "C:/path/to/bookkeeping_file_or_folder" \\
    --output "reconciled_output.csv"
""",
    )
    parser.add_argument(
        "--gst-input",
        required=True,
        help="GST file or folder path (raw Excel or cleaned CSV/Excel)",
    )
    parser.add_argument(
        "--gst-mode",
        choices=["raw", "clean"],
        default="raw",
        help='Whether GST input is "raw" B2B Excel or "clean" processed data (default: raw)',
    )
    parser.add_argument(
        "--books-input",
        required=True,
        help="Bookkeeping file or folder path (raw or cleaned CSV/Excel)",
    )
    parser.add_argument(
        "--books-mode",
        choices=["raw", "clean"],
        default="raw",
        help='Whether books input is "raw" Zoho Books export or "clean" processed data (default: raw)',
    )
    parser.add_argument(
        "--output",
        required=True,
        help="Output CSV/Excel file path",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    try:
        gst_input = args.gst_input
        books_input = args.books_input
        output_path = Path(args.output)
        run_reconciliation(
            gst_input,
            books_input,
            output_path,
            gst_mode=args.gst_mode,
            books_mode=args.books_mode,
        )
    except Exception:
        print("\n❌ Error during processing:")
        print(traceback.format_exc())
        sys.exit(1)


if __name__ == "__main__":
    main()



