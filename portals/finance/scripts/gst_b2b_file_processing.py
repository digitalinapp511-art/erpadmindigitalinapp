#!/usr/bin/env python3
"""
GST B2B File Processing
=======================
Processes GST Excel files (B2B sheet) with full B2B column set and flexible
column matching. Uses the same flatten/rename logic as the standard B2B flow,
with Trade/Legal name, Supply Attract Reverse Charge, Cess, and filing date.

Usage:
    # Single file
    python gst_b2b_file_processing.py -i "path/to/WB 2b.xlsx" -o "cleaned_gst_b2b.xlsx"

    # Folder of files (all *.xlsx / *.xls)
    python gst_b2b_file_processing.py -i "path/to/folder" -o "cleaned_gst_b2b.xlsx"
"""

from __future__ import annotations

import argparse
import sys
import traceback
from pathlib import Path
from typing import Iterable, List, Tuple

import pandas as pd


# =============================================================================
# CONSTANTS (B2B full column set)
# =============================================================================

REQUIRED_COLUMNS = [
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

RENAME_COLUMNS = {
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


def _find_column_mapping(actual_columns: List[str], expected_columns: List[str]) -> dict:
    """
    Map expected column names to actual column names using flexible matching.
    Returns a dictionary mapping expected -> actual column names.
    """
    mapping = {}
    actual_lower = [c.lower() for c in actual_columns]

    column_keywords = {
        "GSTIN_of_supplier_Unnamed:_0_level_1": ["gstin", "supplier"],
        "Trade/Legal name_Unnamed:_1_level_1": ["trade", "legal", "name"],
        "Invoice_Details_Invoice_number": ["invoice", "number"],
        "Invoice_Details_Invoice_Date": ["invoice", "date"],
        "Invoice_Details_Invoice_Value": ["invoice", "value"],
        "Place_of_supply_Unnamed:_6_level_1": ["place", "supply"],
        "Supply Attract Reverse Charge_Unnamed:_7_level_1": ["supply", "attract", "reverse", "charge"],
        "Taxable_Value_Unnamed:_8_level_1": ["taxable", "value"],
        "Tax_Amount_Integrated_Tax": ["integrated", "tax"],
        "Tax_Amount_Central_Tax": ["central", "tax"],
        "Tax_Amount_State/UT_Tax": ["state", "ut", "tax"],
        "Tax_Amount_Cess": ["cess"],
        "GSTR-1/1A/IFF/GSTR-5_Filing_Date_Unnamed:_14_level_1": ["filing", "date", "gstr"],
    }

    for expected in expected_columns:
        if expected in actual_columns:
            mapping[expected] = expected
            continue

        expected_lower = expected.lower()
        if expected_lower in actual_lower:
            idx = actual_lower.index(expected_lower)
            mapping[expected] = actual_columns[idx]
            continue

        keywords = column_keywords.get(expected, [])
        if not keywords:
            key_parts = expected.split("_Unnamed:")[0].lower()
            key_parts = key_parts.replace("/", "_").replace("-", "_").split("_")
            keywords = [p for p in key_parts if p and p not in ["unnamed", "level", "details", "amount"]]

        best_match = None
        best_score = 0

        for actual in actual_columns:
            actual_lower_clean = actual.lower().replace("/", "_").replace("-", "_")
            matches = sum(1 for keyword in keywords if keyword in actual_lower_clean)
            min_required = max(1, int(len(keywords) * 0.5)) if len(keywords) > 2 else len(keywords)

            if matches >= min_required and matches > best_score:
                best_score = matches
                best_match = actual

        if best_match:
            mapping[expected] = best_match
            print(f"    ✓ Matched '{expected}' -> '{best_match}'")
        else:
            raise ValueError(
                f"Could not find column matching '{expected}'. "
                f"Looking for keywords: {keywords}. "
                f"Available columns: {actual_columns[:15]}..." if len(actual_columns) > 15 else f"Available columns: {actual_columns}"
            )

    return mapping


def _load_and_clean(path: Path, sheet_name: str = "B2B") -> pd.DataFrame:
    """
    Load a GST Excel file, flatten columns, select required columns, and rename.
    """
    df_raw = pd.read_excel(path, sheet_name=sheet_name, skiprows=4, header=[0, 1])
    df_raw.columns = _flatten_columns(df_raw.columns)

    print(f"    📋 Found {len(df_raw.columns)} columns")
    if len(df_raw.columns) <= 20:
        print(f"    Columns: {list(df_raw.columns)}")
    else:
        print(f"    First 10 columns: {list(df_raw.columns[:10])}")

    try:
        column_mapping = _find_column_mapping(list(df_raw.columns), REQUIRED_COLUMNS)
    except ValueError as e:
        raise ValueError(f"Column matching failed: {e}")

    actual_required_columns = [column_mapping[req] for req in REQUIRED_COLUMNS]
    df = df_raw[actual_required_columns].copy()

    rename_map = {}
    for expected, clean_name in RENAME_COLUMNS.items():
        actual_col = column_mapping[expected]
        rename_map[actual_col] = clean_name

    df = df.rename(columns=rename_map)

    df["invoice_date"] = pd.to_datetime(df["invoice_date"], errors="coerce", dayfirst=True)
    df["year_month"] = df["invoice_date"].dt.strftime("%Y-%m")
    df["source_file"] = path.name
    return df


def _collect_files(input_path: Path) -> List[Path]:
    """Collect excel files from a file or directory."""
    if input_path.is_file():
        return [input_path]
    return sorted(list(input_path.glob("*.xlsx")) + list(input_path.glob("*.xls")))


# =============================================================================
# CORE PROCESS
# =============================================================================

def _write_output(df: pd.DataFrame, out: Path) -> None:
    """Write DataFrame to CSV or Excel based on file extension."""
    ext = out.suffix.lower()
    if ext in {".xlsx", ".xls"}:
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
        description="GST B2B file processor with full column set and flexible matching.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python gst_b2b_file_processing.py -i "C:/path/WB 2b.xlsx" -o "cleaned_gst_b2b.xlsx"
  python gst_b2b_file_processing.py -i "C:/folder_of_excels" -o "cleaned_gst_b2b.xlsx"
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
        help="Output file path (CSV or Excel; default: <input_parent>/cleaned_gst_b2b.xlsx)",
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

    if not args.input:
        _print_header("GST B2B FILE PROCESSOR")
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
        print("\nEnter output path (press Enter for default: cleaned_gst_b2b.xlsx in input folder):")
        entered_out = input("> ").strip().strip('"').strip("'")
        if entered_out:
            output_path = Path(entered_out).expanduser().resolve()
        else:
            output_path = input_path.parent / "cleaned_gst_b2b.xlsx"

    _print_header("GST B2B FILE PROCESSOR")
    try:
        process_input(str(input_path), str(output_path), sheet_name=args.sheet)
    except Exception:
        print("❌ Error during processing:")
        print(traceback.format_exc())
        sys.exit(1)


if __name__ == "__main__":
    main()
