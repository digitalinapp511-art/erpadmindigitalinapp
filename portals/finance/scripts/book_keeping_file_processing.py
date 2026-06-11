#!/usr/bin/env python3
"""
Book Keeping File Processing
============================
Processes Book Keeping CSV files using the same column-cleaning logic
from `book_keeping.ipynb`, wrapped in a CLI similar to
`gst_file_processing.py`.

Usage:
    # Single file
    python book_keeping_file_processing.py -i "path/to/Bill.csv" -o "cleaned_book_keeping.csv"

    # Folder of files (all *.csv)
    python book_keeping_file_processing.py -i "path/to/folder" -o "cleaned_book_keeping.csv"
"""

from __future__ import annotations

import argparse
import sys
import traceback
from pathlib import Path
from typing import List, Tuple

import pandas as pd


# =============================================================================
# CONSTANTS (from notebook logic)
# =============================================================================

USE_COLUMNS = [
    'Bill Date',
    'Vendor Name',
    'Bill Number',
    'Account',
    'Branch Name',
    'SubTotal',
    'Total',
    'Item Total',
    'IGST',
    'SGST',
    'CGST',
    'CESS',
    'Adjustment',
    'Tax Percentage',
    'GST Identification Number (GSTIN)',
    'Branch ID',
    'Source of Supply',
]

RENAME_COLUMNS = {
    'Bill Date': 'bill_date',
    'Vendor Name': 'vendor_name',
    'Bill Number': 'bill_number',
    'Account': 'account_type',
    'Branch Name': 'branch_name',
    'SubTotal': 'amount_without_tax',
    'Total': 'taxable_value',
    'Item Total': 'item_total',
    'IGST': 'integrated_tax',
    'SGST': 'state_tax',
    'CGST': 'central_tax',
    'CESS': 'cess',
    'Adjustment': 'adjustment',
    'Tax Percentage': 'tax_percentage',
    'GST Identification Number (GSTIN)': 'GSTIN_of_supplier',
    'Branch ID': 'branch_id',
    'Source of Supply': 'place_of_supply',
}


# =============================================================================
# HELPERS
# =============================================================================

def _print_header(title: str):
    bar = "=" * 60
    print(f"\n{bar}\n{title}\n{bar}")


def _load_and_clean(path: Path) -> pd.DataFrame:
    """
    Load a Book Keeping CSV file, select required columns, rename, and clean data.
    """
    # Read CSV/Excel with bill_number as object (string) to preserve numbers as text
    dtype_dict = {'Bill Number': str}
    ext = path.suffix.lower()

    try:
        if ext in ['.xlsx', '.xls']:
            df_raw = pd.read_excel(path, usecols=USE_COLUMNS, dtype=dtype_dict)
        else:
            df_raw = pd.read_csv(path, usecols=USE_COLUMNS, dtype=dtype_dict)
    except KeyError as e:
        # If some columns are missing, try to read all and check what's available
        if ext in ['.xlsx', '.xls']:
            df_all = pd.read_excel(path)
        else:
            df_all = pd.read_csv(path)
        missing = [c for c in USE_COLUMNS if c not in df_all.columns]
        raise ValueError(f"Missing required columns: {missing}") from e

    df = df_raw.copy()
    df = df.rename(columns=RENAME_COLUMNS)
    
    # Derive year-month from bill_date
    df['bill_date'] = pd.to_datetime(df['bill_date'], errors='coerce', dayfirst=True)
    df['year_month'] = df['bill_date'].dt.strftime("%Y-%m")
    
    # Convert branch_id to text (string)
    df['branch_id'] = df['branch_id'].astype(str)
    
    # Fill NA with 0 for amount_without_tax and round to 2 decimal places
    df['amount_without_tax'] = df['amount_without_tax'].fillna(0).round(2)
    
    # Fill NA with 0 and ensure 2 decimal places for specific tax/adjustment columns
    decimal_cols = [
        'integrated_tax',
        'state_tax',
        'central_tax',
        'adjustment',
        'taxable_value',
        'cess',
        'item_total',
        'tax_percentage',
        'amount_without_tax',
        'taxable_value'
    ]
    for col in decimal_cols:
        df[col] = df[col].fillna(0).round(2).astype(float)
    
    # Fill NA with "Not available" for GSTIN_of_supplier
    df['GSTIN_of_supplier'] = df['GSTIN_of_supplier'].fillna('Not available')
    
    df["source_file"] = path.name
    return df


def _collect_files(input_path: Path) -> List[Path]:
    """
    Collect CSV or Excel files from a file or directory.
    """
    if input_path.is_file():
        return [input_path]
    
    # Collect all supported extensions
    supported_ext = {'.csv', '.xlsx', '.xls'}
    found = []
    if input_path.is_dir():
        for p in input_path.iterdir():
            if p.is_file() and p.suffix.lower() in supported_ext:
                found.append(p)
    return sorted(found)



# =============================================================================
# CORE PROCESS
# =============================================================================

def _write_output(df: pd.DataFrame, out: Path) -> None:
    """
    Write DataFrame to CSV or Excel based on file extension.
    For CSV, format decimal columns to show 2 decimal places (e.g., 2345.00).
    """
    ext = out.suffix.lower()
    
    # Columns that should always display 2 decimal places
    decimal_cols = [
        'integrated_tax',
        'state_tax',
        'central_tax',
        'adjustment',
        'taxable_value',
        'cess',
        'item_total',
        'tax_percentage',
        'amount_without_tax',
        'taxable_value'
    ]
    
    if ext in {".xlsx", ".xls"}:
        df.to_excel(out, index=False)
    else:
        # For CSV, format decimal columns to ensure 2 decimal places.
        # Coerce to numeric first so string values from Excel don't break formatting.
        df_output = df.copy()
        for col in decimal_cols:
            if col in df_output.columns:
                s = pd.to_numeric(df_output[col], errors="coerce").fillna(0)
                df_output[col] = s.apply(lambda x: f"{x:.2f}")
        df_output.to_csv(out, index=False)


def process_input(input_path: str, output_path: str) -> Tuple[int, int]:
    """
    Process a single file or a directory of files.

    Returns:
        tuple: (files_processed, rows_written)
    """
    inp = Path(input_path).expanduser().resolve()
    out = Path(output_path).expanduser().resolve()

    files = _collect_files(inp)
    if not files:
        raise FileNotFoundError(f"No CSV files found at {inp}")

    frames: List[pd.DataFrame] = []
    for f in files:
        try:
            print(f"  → Processing {f.name}")
            frames.append(_load_and_clean(f))
        except Exception as e:
            print(f"  ✗ Skipped {f.name}: {e}")
            continue

    if not frames:
        raise RuntimeError("No files processed successfully.")

    combined = pd.concat(frames, ignore_index=True, sort=False)
    out.parent.mkdir(parents=True, exist_ok=True)
    _write_output(combined, out)

    print(f"\n✅ Saved cleaned data to {out}")
    print(f"   Files processed: {len(frames)}")
    print(f"   Rows written   : {combined.shape[0]}")
    return len(frames), combined.shape[0]


# =============================================================================
# CLI
# =============================================================================

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Book Keeping file processor (CSV) with notebook logic.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python book_keeping_file_processing.py -i "C:/path/Bill.csv" -o "cleaned_book_keeping.csv"
  python book_keeping_file_processing.py -i "C:/folder_of_csvs" -o "cleaned_book_keeping.csv"
""",
    )

    parser.add_argument(
        "-i",
        "--input",
        required=False,
        help="Input CSV file or folder path (if omitted, you will be prompted)",
    )
    parser.add_argument(
        "-o",
        "--output",
        required=False,
        default=None,
        help="Output CSV file path (if omitted, you will be prompted; default: <input_parent>/cleaned_book_keeping.csv)",
    )

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()

    # Interactive prompts when paths are missing
    if not args.input:
        _print_header("BOOK KEEPING FILE PROCESSOR")
        print("Enter the input CSV file or folder path (drag-drop allowed):")
        entered = input("> ").strip().strip('"').strip("'")
        if not entered:
            print("❌ No input provided.")
            sys.exit(1)
        args.input = entered

    input_path = Path(args.input).expanduser().resolve()

    if args.output:
        output_path = Path(args.output).expanduser().resolve()
    else:
        print("\nEnter output CSV path (press Enter for default: cleaned_book_keeping.csv in input folder):")
        entered_out = input("> ").strip().strip('"').strip("'")
        if entered_out:
            output_path = Path(entered_out).expanduser().resolve()
        else:
            output_path = input_path.parent / "cleaned_book_keeping.csv"

    _print_header("BOOK KEEPING FILE PROCESSOR")
    try:
        process_input(str(input_path), str(output_path))
    except Exception:
        print("❌ Error during processing:")
        print(traceback.format_exc())
        sys.exit(1)


if __name__ == "__main__":
    main()

