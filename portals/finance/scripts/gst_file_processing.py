#!/usr/bin/env python3
"""
GST File Processing
===================
Processes GST Excel files (B2B sheet) using the same column-cleaning logic
from `gst_standard_process.ipynb`, wrapped in a CLI similar to
`amazon_tax_invoice_extractor.py`.

Usage:
    # Single file
    python gst_file_processing.py -i "path/to/WB 2b.xlsx" -o "cleaned_gst.csv"

    # Folder of files (all *.xlsx / *.xls)
    python gst_file_processing.py -i "path/to/folder" -o "cleaned_gst.csv"
"""

from __future__ import annotations

import argparse
import sys
import traceback
from pathlib import Path
from typing import Iterable, List, Optional, Tuple

import pandas as pd


# =============================================================================
# CONSTANTS (from notebook logic)
# =============================================================================

REQUIRED_COLUMNS = [
    "GSTIN_of_supplier_Unnamed:_0_level_1",
    "Invoice_Details_Invoice_number",
    "Invoice_Details_Invoice_Date",
    "Invoice_Details_Invoice_Value",
    "Place_of_supply_Unnamed:_6_level_1",
    "Taxable_Value_Unnamed:_8_level_1",
    "Tax_Amount_Integrated_Tax",
    "Tax_Amount_Central_Tax",
    "Tax_Amount_State/UT_Tax",
    "GSTR-1/1A/IFF/GSTR-5_Filing_Date_Unnamed:_14_level_1",
]

RENAME_COLUMNS = {
    "GSTIN_of_supplier_Unnamed:_0_level_1": "GSTIN_of_supplier",
    "Invoice_Details_Invoice_number": "invoice_number",
    "Invoice_Details_Invoice_Date": "invoice_date",
    "Invoice_Details_Invoice_Value": "invoice_value",
    "Place_of_supply_Unnamed:_6_level_1": "place_of_supply",
    "Taxable_Value_Unnamed:_8_level_1": "taxable_value",
    "Tax_Amount_Integrated_Tax": "integrated_tax",
    "Tax_Amount_Central_Tax": "central_tax",
    "Tax_Amount_State/UT_Tax": "state_tax",
    "GSTR-1/1A/IFF/GSTR-5_Filing_Date_Unnamed:_14_level_1": "filing_date",
}


# =============================================================================
# HELPERS
# =============================================================================

def _print_header(title: str):
    bar = "=" * 60
    print(f"\n{bar}\n{title}\n{bar}")


def _flatten_columns(columns: Iterable[Tuple]) -> List[str]:
    """
    Flatten MultiIndex columns by joining non-empty parts with "_"
    and applying the same cleaning as the notebook.
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


def _load_and_clean(path: Path, sheet_name: str = "B2B") -> pd.DataFrame:
    """
    Load a GST Excel file, flatten columns, select required columns, and rename.
    """
    df_raw = pd.read_excel(path, sheet_name=sheet_name, skiprows=4, header=[0, 1])
    df_raw.columns = _flatten_columns(df_raw.columns)

    missing = [c for c in REQUIRED_COLUMNS if c not in df_raw.columns]
    if missing:
        raise ValueError(f"Missing required columns: {missing}")

    df = df_raw[REQUIRED_COLUMNS].copy()
    df = df.rename(columns=RENAME_COLUMNS)
    df["source_file"] = path.name
    return df


def _collect_files(input_path: Path) -> List[Path]:
    """
    Collect excel files from a file or directory.
    """
    if input_path.is_file():
        return [input_path]
    return sorted(list(input_path.glob("*.xlsx")) + list(input_path.glob("*.xls")))


# =============================================================================
# CORE PROCESS
# =============================================================================

def _write_output(df: pd.DataFrame, out: Path) -> None:
    """
    Write DataFrame to CSV or Excel based on file extension.
    """
    ext = out.suffix.lower()
    if ext in {".xlsx", ".xls",".csv"}:
        df.to_excel(out, index=False)
    else:
        df.to_csv(out, index=False)


def process_input(input_path: str, output_path: str, sheet_name: str = "B2B") -> Tuple[int, int]:
    """
    Process a single file or a directory of files.

    Returns:
        tuple: (files_processed, rows_written)
    """
    inp = Path(input_path).expanduser().resolve()
    out = Path(output_path).expanduser().resolve()

    files = _collect_files(inp)
    if not files:
        raise FileNotFoundError(f"No Excel files found at {inp}")

    frames: List[pd.DataFrame] = []
    for f in files:
        try:
            print(f"  → Processing {f.name}")
            frames.append(_load_and_clean(f, sheet_name=sheet_name))
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
        description="GST file processor (B2B sheet) with notebook logic.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python gst_file_processing.py -i "C:/path/WB 2b.xlsx" -o "cleaned_gst.csv"
  python gst_file_processing.py -i "C:/folder_of_excels" -o "cleaned_gst.csv"
""",
    )

    parser.add_argument(
        "-i",
        "--input",
        required=False,
        help="Input Excel file or folder path (if omitted, you will be prompted)",
    )
    parser.add_argument(
        "-o",
        "--output",
        required=False,
        default=None,
        help="Output CSV file path (if omitted, you will be prompted; default: <input_parent>/cleaned_gst.csv)",
    )
    parser.add_argument(
        "-s",
        "--sheet",
        required=False,
        default="B2B",
        help="Sheet name to read (default: B2B)",
    )

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()

    # Interactive prompts when paths are missing
    if not args.input:
        _print_header("GST FILE PROCESSOR")
        print("Enter the input Excel file or folder path (drag-drop allowed):")
        entered = input("> ").strip().strip('"').strip("'")
        if not entered:
            print("❌ No input provided.")
            sys.exit(1)
        args.input = entered

    input_path = Path(args.input).expanduser().resolve()

    if args.output:
        output_path = Path(args.output).expanduser().resolve()
    else:
        print("\nEnter output CSV path (press Enter for default: cleaned_gst.csv in input folder):")
        entered_out = input("> ").strip().strip('"').strip("'")
        if entered_out:
            output_path = Path(entered_out).expanduser().resolve()
        else:
            output_path = input_path.parent / "cleaned_gst.csv"

    _print_header("GST FILE PROCESSOR")
    try:
        process_input(str(input_path), str(output_path), sheet_name=args.sheet)
    except Exception:
        print("❌ Error during processing:")
        print(traceback.format_exc())
        sys.exit(1)


if __name__ == "__main__":
    main()

