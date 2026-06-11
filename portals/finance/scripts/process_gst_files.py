#!/usr/bin/env python3
"""
GST File Processor
==================
Processes single or multiple GST Excel files, extracts data from worksheets,
combines info_data with each worksheet, and appends similar worksheets from all files.

Usage:
    # Interactive mode
    python process_gst_files.py
    
    # Command-line mode (for API)
    python process_gst_files.py -i "path/to/file_or_folder" -o "output.xlsx"
"""

import pandas as pd
import numpy as np
import re
import argparse
import sys
from pathlib import Path
from datetime import datetime
import os



def get_file_path(prompt, file_type="file_or_folder"):
    """Get file or folder path from user with drag-and-drop support
    
    Args:
        prompt: Prompt message to display
        file_type: "file", "folder", or "file_or_folder" (default: accepts both)
    
    Returns:
        String path or None
    """
    print(f"\n{prompt}")
    print("(You can drag & drop the file/folder here)")
    path = input("> ").strip().strip('"').strip("'")
    
    if not path:
        return None
    
    path = Path(path)
    
    if not path.exists():
        print(f"❌ Error: Path does not exist: {path}")
        return None
    
    if file_type == "file" and not path.is_file():
        print(f"❌ Error: Path is not a file: {path}")
        return None
    elif file_type == "folder" and not path.is_dir():
        print(f"❌ Error: Path is not a folder: {path}")
        return None
    elif file_type == "file_or_folder":
        # Accept both files and folders
        if not (path.is_file() or path.is_dir()):
            print(f"❌ Error: Path is neither a file nor a folder: {path}")
            return None
    
    return str(path)


def extract_value(df, label):
    """Extract value from dataframe based on label (case-insensitive)"""
    # Convert dataframe to string for searching
    for idx, row in df.iterrows():
        row_str = ' '.join([str(val) for val in row.values if pd.notna(val)])
        if label.lower() in row_str.lower():
            # Try to find the value in the same row
            for col in df.columns:
                cell_value = str(row[col]).strip()
                if cell_value and cell_value.lower() != label.lower() and cell_value != 'nan':
                    return cell_value
    return None


def extract_info_data(file_path):
    """Extract info_data from 'Read me' sheet"""
    try:
        dataframe_1 = pd.read_excel(file_path, sheet_name='Read me')
        
        # Extract each field
        financial_year = extract_value(dataframe_1, 'Financial Year')
        tax_period = extract_value(dataframe_1, 'Tax Period')
        gstin = extract_value(dataframe_1, 'GSTIN')
        legal_name = extract_value(dataframe_1, 'Legal Name')
        trade_name = extract_value(dataframe_1, 'Trade Name (if any)')
        date_of_generation = extract_value(dataframe_1, 'Date of generation')
        
        # Alternative method: If dataframe has specific structure (label-value pairs)
        if len(dataframe_1.columns) >= 2:
            col0 = dataframe_1.iloc[:, 0].astype(str).str.strip()
            col1 = dataframe_1.iloc[:, 1].astype(str).str.strip() if len(dataframe_1.columns) > 1 else None
            
            if col1 is not None:
                # Create a dictionary for easier lookup
                info_dict = {}
                for idx in range(len(dataframe_1)):
                    label = col0.iloc[idx]
                    value = col1.iloc[idx] if idx < len(col1) else None
                    if pd.notna(label) and pd.notna(value) and label != 'nan' and value != 'nan':
                        info_dict[label.lower()] = value
                
                # Extract using dictionary
                financial_year = info_dict.get('financial year', financial_year)
                tax_period = info_dict.get('tax period', tax_period)
                gstin = info_dict.get('gstin', gstin)
                legal_name = info_dict.get('legal name', legal_name)
                trade_name = info_dict.get('trade name (if any)', info_dict.get('trade name', trade_name))
                date_of_generation = info_dict.get('date of generation', date_of_generation)
        
        extracted_info = {
            'Financial Year': financial_year,
            'Tax Period': tax_period,
            'GSTIN': gstin,
            'Legal Name': legal_name,
            'Trade Name (if any)': trade_name,
            'Date of generation': date_of_generation
        }
        
        return extracted_info
        
    except Exception as e:
        print(f"❌ Error extracting info_data from {file_path}: {e}")
        return None


def clean_column_names(df):
    """Remove number_level_number pattern from column names"""
    if df is None:
        return df
    
    pattern = r'\d+_level_\d+\s*'
    
    # Create new column names by removing the pattern
    new_columns = []
    for col in df.columns:
        # Remove the pattern (case-insensitive, with optional spaces)
        cleaned_col = re.sub(pattern, '', str(col), flags=re.IGNORECASE)
        # Also handle variations like "level_number" or just remove any "level_X" pattern
        cleaned_col = re.sub(r'level_\d+\s*', '', cleaned_col, flags=re.IGNORECASE)
        # Clean up extra spaces
        cleaned_col = cleaned_col.strip()
        new_columns.append(cleaned_col)
    
    df.columns = new_columns
    return df


def make_columns_unique(df):
    """Make column names unique by appending suffix if duplicates exist"""
    if df is None:
        return df
    
    cols = list(df.columns)
    seen = {}
    new_cols = []
    
    for col in cols:
        if col in seen:
            seen[col] += 1
            new_col = f"{col}_{seen[col]}"
            new_cols.append(new_col)
        else:
            seen[col] = 0
            new_cols.append(col)
    
    df.columns = new_cols
    return df


def read_worksheet(file_path, sheet_name, header_row_1, header_row_2):
    """Read worksheet with specified header rows and handle merged cells properly"""
    try:
        # Read raw data without headers to manually process merged cells
        raw_data = pd.read_excel(
            file_path, 
            sheet_name=sheet_name, 
            header=None
        )
        
        # Get header rows
        header_row_1_data = raw_data.iloc[header_row_1].astype(str)
        header_row_2_data = raw_data.iloc[header_row_2].astype(str)
        
        # Forward fill NaN/empty values in first header row (handles merged cells)
        # When a cell is merged in Excel, pandas reads it as NaN in subsequent columns
        header_row_1_filled = []
        last_value = None
        for val in header_row_1_data:
            val_str = str(val).strip()
            # Check if value is empty/NaN
            if val_str.lower() in ['nan', 'none', 'nat', ''] or pd.isna(val):
                if last_value:
                    header_row_1_filled.append(last_value)
                else:
                    header_row_1_filled.append('')
            else:
                header_row_1_filled.append(val_str)
                last_value = val_str
        
        # Now construct column names by combining both header rows intelligently
        column_names = []
        for i in range(len(header_row_1_filled)):
            col0 = header_row_1_filled[i].strip()
            col1 = str(header_row_2_data.iloc[i]).strip() if i < len(header_row_2_data) else ''
            
            # Clean up pandas artifacts
            col0 = col0.replace('nan', '').replace('None', '').replace('NaT', '')
            col1 = col1.replace('nan', '').replace('None', '').replace('NaT', '')
            
            # Combine headers intelligently
            if not col0 or col0 == '':
                # First level is empty (merged cell), use second level
                combined = col1 if col1 and col1 != '' else f"Column_{i+1}"
            elif not col1 or col1 == '':
                # Second level is empty, use first level
                combined = col0
            else:
                # Both have values - combine them
                # If first level looks like a parent header (shorter, more general), combine with space
                # Otherwise, prefer the more specific second level
                if len(col0) < len(col1) and col0.lower() not in col1.lower():
                    # First level is likely a parent header (e.g., "Invoice Details")
                    combined = f"{col0} {col1}".strip()
                elif col1.lower() in col0.lower():
                    # Second level is subset of first, use first
                    combined = col0
                else:
                    # Use second level as primary, with first as prefix if meaningful
                    combined = f"{col0} {col1}".strip()
            
            column_names.append(combined)
        
        # Now read the data starting from the row after headers
        data_start_row = max(header_row_1, header_row_2) + 1
        df = pd.read_excel(
            file_path, 
            sheet_name=sheet_name, 
            header=None,
            skiprows=data_start_row
        )
        
        # Set column names
        # Handle case where data has more columns than headers
        if len(df.columns) > len(column_names):
            # Add default names for extra columns
            for i in range(len(column_names), len(df.columns)):
                column_names.append(f"Column_{i+1}")
        elif len(df.columns) < len(column_names):
            # Truncate column names if data has fewer columns
            column_names = column_names[:len(df.columns)]
        
        df.columns = column_names[:len(df.columns)]
        
        # Clean column names (remove patterns like "0 0.1", empty values, etc.)
        new_columns = []
        for i, col_name in enumerate(df.columns):
            col_str = str(col_name).strip()
            # Remove patterns like "0 0", "0 0.1", "0.0 0.1", etc. (empty merged cells)
            if re.match(r'^0\s*0(\.\d+)?$', col_str) or re.match(r'^0\.0\s*0(\.\d+)?$', col_str):
                new_columns.append(f"Column_{i+1}")
            # Remove "nan", "None", empty strings
            elif col_str.lower() in ['nan', 'none', 'nat', '']:
                new_columns.append(f"Column_{i+1}")
            else:
                new_columns.append(col_str)
        
        df.columns = new_columns
        
        # Make column names unique (handle duplicates from Excel)
        df = make_columns_unique(df)
        
        # Remove rows that are completely empty
        df = df.dropna(how='all')
        
        # Remove rows where all values are empty strings
        df = df[~(df.astype(str).apply(lambda x: x.str.strip().eq('') | x.eq('nan')).all(axis=1))]
        
        # Clean column names (remove number_level_number pattern)
        df = clean_column_names(df)
        
        # Make column names unique again after cleaning (in case cleaning created duplicates)
        df = make_columns_unique(df)
        
        return df
        
    except Exception as e:
        print(f"⚠️  Warning: Could not read '{sheet_name}' from {file_path}: {e}")
        import traceback
        traceback.print_exc()
        return None


def process_single_file(file_path):
    """Process a single Excel file and return combined dataframes"""
    print(f"\n{'='*60}")
    print(f"Processing: {Path(file_path).name}")
    print(f"{'='*60}")
    
    # Extract info_data
    info_data = extract_info_data(file_path)
    if info_data is None:
        print(f"❌ Skipping {file_path}: Could not extract info_data")
        return None
    
    print(f"✅ Extracted info_data: {info_data.get('GSTIN', 'N/A')} - {info_data.get('Tax Period', 'N/A')}")
    
    # Define worksheet configurations: (sheet_name, header_row_1, header_row_2)
    worksheets_config = [
        ('B2B', 4, 5),           # rows 5 and 6 (0-indexed: 4 and 5)
        ('B2BA', 5, 6),          # rows 6 and 7 (0-indexed: 5 and 6)
        ('B2B-CDNR', 4, 5),      # rows 5 and 6 (0-indexed: 4 and 5)
        ('IMPG', 4, 5),          # rows 5 and 6 (0-indexed: 4 and 5)
        ('B2B-CDNRA', 5, 6),     # rows 6 and 7 (0-indexed: 5 and 6)
    ]
    
    # Dictionary to store combined dataframes for this file
    file_dataframes = {}
    
    # Read each worksheet and combine with info_data
    for sheet_name, header_row_1, header_row_2 in worksheets_config:
        df = read_worksheet(file_path, sheet_name, header_row_1, header_row_2)
        
        if df is not None and len(df) > 0:
            # Store original columns (before adding info_data)
            original_cols = [col for col in df.columns]
            
            # Add info_data columns to the dataframe
            for key, value in info_data.items():
                df[key] = value
            
            # Add source file name column
            df['Source File'] = Path(file_path).name
            
            # Define the desired column order:
            # 1. Financial Year
            # 2. Tax Period
            # 3. GSTIN
            # 4. Legal Name
            # 5. Trade Name (if any)
            # 6. Date of generation
            # 7. Source File
            # 8. Rest of the original columns
            info_cols_order = [
                'Financial Year',
                'Tax Period',
                'GSTIN',
                'Legal Name',
                'Trade Name (if any)',
                'Date of generation'
            ]
            
            # Get info columns in the desired order (only those that exist)
            ordered_info_cols = [col for col in info_cols_order if col in df.columns]
            
            # Get remaining info columns (if any) that weren't in the order list
            all_info_cols = list(info_data.keys())
            remaining_info_cols = [col for col in all_info_cols if col not in ordered_info_cols]
            
            # Get original columns (excluding info_data and Source File)
            original_cols_clean = [col for col in original_cols if col not in all_info_cols and col != 'Source File']
            
            # Final column order: ordered info cols + remaining info cols + Source File + original cols
            final_column_order = ordered_info_cols + remaining_info_cols + ['Source File'] + original_cols_clean
            
            # Reorder dataframe columns
            df = df[final_column_order]
            
            file_dataframes[sheet_name] = df
            print(f"✅ Loaded '{sheet_name}': {len(df)} rows, {len(df.columns)} columns")
        else:
            print(f"⚠️  '{sheet_name}': No data or empty")
    
    return file_dataframes


def get_excel_files(input_path, recursive=True):
    """Get list of Excel files from input path (file or folder)
    
    Args:
        input_path: Path to file or folder
        recursive: If True, search subdirectories recursively (default: True)
    
    Returns:
        List of Excel file paths
    """
    input_path = Path(input_path)
    
    if input_path.is_file():
        file_ext = input_path.suffix.lower()
        if file_ext in ['.xlsx', '.xls']:
            return [str(input_path)]
        else:
            if file_ext == '.pdf':
                print(f"❌ Error: PDF files are not supported. Please provide an Excel file (.xlsx or .xls)")
            else:
                print(f"❌ Error: {input_path} is not an Excel file. Only .xlsx and .xls files are supported.")
            return []
    elif input_path.is_dir():
        excel_files = []
        if recursive:
            # Search recursively in all subdirectories
            for ext in ['*.xlsx', '*.xls']:
                excel_files.extend(input_path.rglob(ext))  # rglob for recursive search
        else:
            # Search only in the immediate directory
            for ext in ['*.xlsx', '*.xls']:
                excel_files.extend(input_path.glob(ext))
        
        excel_files = sorted([str(f) for f in excel_files])
        
        if excel_files:
            print(f"\n📂 Searching in folder: {input_path}")
            if recursive:
                print(f"   (including subdirectories)")
            print(f"   Found {len(excel_files)} Excel file(s):")
            for i, file in enumerate(excel_files, 1):
                rel_path = Path(file).relative_to(input_path)
                print(f"   {i}. {rel_path}")
        
        return excel_files
    else:
        print(f"❌ Error: {input_path} is not a valid file or folder")
        return []


def align_columns(df_list):
    """Align columns across multiple dataframes by adding missing columns
    while preserving the desired column order and ensuring unique column names"""
    if not df_list:
        return df_list
    
    # First, make sure all dataframes have unique column names
    for i, df in enumerate(df_list):
        if df is not None:
            df_list[i] = make_columns_unique(df.copy())
    
    # Define the desired column order (priority columns first)
    priority_columns_order = [
        'Financial Year',
        'Tax Period',
        'GSTIN',
        'Legal Name',
        'Trade Name (if any)',
        'Date of generation',
        'Source File'
    ]
    
    # Get all unique columns from all dataframes (as a list to preserve order)
    all_columns_list = []
    all_columns_set = set()
    for df in df_list:
        if df is not None:
            for col in df.columns:
                if col not in all_columns_set:
                    all_columns_list.append(col)
                    all_columns_set.add(col)
    
    # Build ordered column list: priority columns first, then rest in order they appear
    ordered_columns = []
    
    # Add priority columns in order (only if they exist)
    for col in priority_columns_order:
        if col in all_columns_set:
            ordered_columns.append(col)
    
    # Add remaining columns (excluding priority columns) in the order they first appeared
    remaining_columns = [col for col in all_columns_list if col not in priority_columns_order]
    ordered_columns.extend(remaining_columns)
    
    # Ensure ordered_columns is unique (in case of any duplicates)
    seen = set()
    unique_ordered_columns = []
    for col in ordered_columns:
        if col not in seen:
            unique_ordered_columns.append(col)
            seen.add(col)
    ordered_columns = unique_ordered_columns
    
    # Add missing columns to each dataframe
    aligned_dfs = []
    for df in df_list:
        if df is not None:
            # Make a copy to avoid modifying original
            df_aligned = df.copy()
            
            # Add missing columns
            for col in ordered_columns:
                if col not in df_aligned.columns:
                    df_aligned[col] = None
            
            # Reorder columns to match ordered_columns (only include columns that exist)
            existing_ordered_cols = [col for col in ordered_columns if col in df_aligned.columns]
            df_aligned = df_aligned[existing_ordered_cols]
            
            aligned_dfs.append(df_aligned)
        else:
            aligned_dfs.append(None)
    
    return aligned_dfs


def process_files(input_path, output_path=None):
    """Process GST files - core processing logic"""
    input_path_obj = Path(input_path)
    
    # Check if it's a folder and confirm
    if input_path_obj.is_dir():
        print(f"\n✅ Folder detected: {input_path}")
        print(f"   Will process all Excel files (.xlsx, .xls) in this folder and subdirectories")
    
    # Get Excel files
    excel_files = get_excel_files(input_path, recursive=True)
    if not excel_files:
        print("❌ No Excel files found. Exiting.")
        return None
    
    print(f"\n📁 Total: {len(excel_files)} Excel file(s) to process")
    
    # Dictionary to store all dataframes by worksheet type
    # Structure: {worksheet_name: [list of dataframes from all files]}
    all_worksheets_data = {
        'B2B': [],
        'B2BA': [],
        'B2B-CDNR': [],
        'IMPG': [],
        'B2B-CDNRA': []
    }
    
    # Process each file
    processed_count = 0
    for file_path in excel_files:
        file_dataframes = process_single_file(file_path)
        
        if file_dataframes:
            # Add each worksheet dataframe to the corresponding list
            for sheet_name, df in file_dataframes.items():
                if sheet_name in all_worksheets_data:
                    all_worksheets_data[sheet_name].append(df)
            processed_count += 1
    
    print(f"\n{'='*60}")
    print(f"Processing Summary: {processed_count}/{len(excel_files)} files processed successfully")
    print(f"{'='*60}")
    
    # Combine similar worksheets from all files
    print(f"\n{'='*60}")
    print("Combining worksheets from all files...")
    print(f"{'='*60}")
    
    combined_dataframes = {}
    
    for sheet_name, df_list in all_worksheets_data.items():
        if df_list:
            # Align columns across all dataframes
            aligned_dfs = align_columns(df_list)
            
            # Concatenate all dataframes
            combined_df = pd.concat(aligned_dfs, ignore_index=True)
            combined_dataframes[sheet_name] = combined_df
            print(f"✅ Combined '{sheet_name}': {len(combined_df)} total rows from {len(df_list)} file(s)")
        else:
            print(f"⚠️  '{sheet_name}': No data from any file")
    
    if not combined_dataframes:
        print("\n❌ No data to export. Exiting.")
        return None
    
    # Determine output path
    if output_path is None:
        # Default output location: same as input or current directory
        if Path(input_path).is_file():
            default_dir = Path(input_path).parent
        else:
            default_dir = Path(input_path)
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_path = default_dir / f"GST_Combined_{timestamp}.xlsx"
    else:
        output_path = Path(output_path)
        
        # If user provided a folder, create file in that folder
        if output_path.is_dir():
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_path = output_path / f"GST_Combined_{timestamp}.xlsx"
        else:
            # User provided a file path
            # Ensure .xlsx extension
            if output_path.suffix.lower() != '.xlsx':
                output_path = output_path.with_suffix('.xlsx')
    
    # Create output directory if it doesn't exist
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    # Export to Excel
    print(f"\n{'='*60}")
    print("Exporting to Excel...")
    print(f"{'='*60}")
    
    try:
        with pd.ExcelWriter(output_path, engine='openpyxl') as writer:
            for sheet_name, df in combined_dataframes.items():
                # Excel sheet names have a 31 character limit
                excel_sheet_name = sheet_name[:31] if len(sheet_name) > 31 else sheet_name
                df.to_excel(writer, sheet_name=excel_sheet_name, index=False)
                print(f"✅ Exported '{sheet_name}' → {len(df)} rows")
        
        print(f"\n{'='*60}")
        print(f"✅ Output file created successfully!")
        print(f"📁 File path: {output_path}")
        print(f"📊 Total worksheets: {len(combined_dataframes)}")
        print(f"{'='*60}")
        
        # Print summary
        print(f"\nSummary by worksheet:")
        for sheet_name, df in combined_dataframes.items():
            print(f"  - {sheet_name}: {len(df)} rows")
        
        return str(output_path)
        
    except Exception as e:
        print(f"❌ Error creating output file: {e}")
        import traceback
        traceback.print_exc()
        return None


def main():
    """Main function - supports both interactive and command-line modes"""
    # Check for command-line arguments
    parser = argparse.ArgumentParser(
        description='Process GST Excel files and merge worksheets',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        '-i', '--input',
        help='Input Excel file or folder containing Excel files (optional for interactive mode)'
    )
    parser.add_argument(
        '-o', '--output',
        help='Output Excel file path (optional for interactive mode)'
    )
    
    args = parser.parse_args()
    
    print("\n" + "="*60)
    print("  GST FILE PROCESSOR")
    print("="*60)
    
    # If command-line arguments provided, use them
    if args.input:
        if not Path(args.input).exists():
            print(f"❌ Error: Input path does not exist: {args.input}")
            sys.exit(1)
        process_files(args.input, args.output)
        return
    
    # Otherwise, use interactive mode
    input_path = get_file_path("Enter path to Excel file or folder containing Excel files:")
    if not input_path:
        print("❌ No input path provided. Exiting.")
        return
    
    # Get output location
    print(f"\n{'='*60}")
    output_path_input = get_file_path("Enter output file path or folder (or press Enter for default location):", file_type="file_or_folder")
    
    process_files(input_path, output_path_input)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nOperation cancelled by user.")
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()

