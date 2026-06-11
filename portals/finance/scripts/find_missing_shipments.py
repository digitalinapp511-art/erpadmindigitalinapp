#!/usr/bin/env python3
"""
Amazon Shipment Tracker - Missing Shipment ID Finder
====================================================
Compares Shipment IDs from main_data CSV with Reference No. from country-specific Excel worksheets
and identifies missing Shipment IDs.

Usage:
    # Interactive mode
    python find_missing_shipments.py
    
    # Command-line mode (for API)
    python find_missing_shipments.py -m "main_data.csv" -c "country.xlsx" -s "SheetName" -o "output.xlsx"
"""

import pandas as pd
import os
import argparse
import sys
from pathlib import Path
from datetime import datetime


def get_file_path(prompt, file_type="file"):
    """Get file path from user with drag-and-drop support"""
    print(f"\n{prompt}")
    print("(You can drag & drop the file here)")
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
    
    return str(path)


def get_available_sheets(excel_path):
    """Get list of available worksheets from Excel file"""
    try:
        excel_file = pd.ExcelFile(excel_path)
        sheets = excel_file.sheet_names
        return sheets
    except Exception as e:
        print(f"❌ Error reading Excel file: {e}")
        return None


def select_country_sheet(sheets):
    """Let user select which country worksheet to use"""
    print(f"\n{'='*60}")
    print("Available Country Worksheets:")
    print('='*60)
    
    for i, sheet in enumerate(sheets, 1):
        print(f"  {i}. {sheet}")
    
    print('='*60)
    
    while True:
        try:
            choice = input(f"\nSelect country worksheet (1-{len(sheets)}) or enter sheet name: ").strip()
            
            # Try to parse as number
            if choice.isdigit():
                idx = int(choice) - 1
                if 0 <= idx < len(sheets):
                    return sheets[idx]
                else:
                    print(f"❌ Invalid selection. Please enter a number between 1 and {len(sheets)}")
                    continue
            
            # Try to match by name (case-insensitive)
            choice_lower = choice.upper()
            for sheet in sheets:
                if sheet.upper() == choice_lower:
                    return sheet
            
            print(f"❌ Sheet '{choice}' not found. Please try again.")
            
        except KeyboardInterrupt:
            print("\n\nOperation cancelled by user.")
            return None
        except Exception as e:
            print(f"❌ Error: {e}")


def load_main_data(csv_path):
    """Load and prepare main_data from CSV with column renaming and date cleaning"""
    try:
        print(f"\n📂 Loading main_data from: {csv_path}")
        
        # Define required columns and column renaming (matching notebook)
        required_col = ['shipmentId', 'shipmentName', 'destinationFC', 'shipmentStatus', 'mskus',
                        'CREATING_date', 'RECEIVING_date', 'SHIPPED_date', 'CLOSED_date',
                        'merchantSKU',
                        'expectedQuantity_item', 'totalReceivedQuantity',
                        'totalDiscrepancyQuantity']
        
        col_rename = {'shipmentName': 'Shipment Name', 'shipmentId': 'Shipment ID', 
                      'destinationFC': 'Destination FC', 'shipmentStatus': 'Shipment Status', 
                      'mskus': 'Total SKUs',
                      'CREATING_date': 'Creating Date', 'RECEIVING_date': 'Receiving Date', 
                      'SHIPPED_date': 'Shipping Date', 'CLOSED_date': 'Closed Date',
                      'merchantSKU': 'SKU',
                      'expectedQuantity_item': 'Total Expected Quantity', 
                      'totalReceivedQuantity': 'Total Received Quantity',
                      'totalDiscrepancyQuantity': 'Total Discrepancy Quantity'}
        
        # Read CSV - try to use only required columns if they exist
        main_data = pd.read_csv(csv_path)
        
        # Check if 'Shipment ID' or 'shipmentId' column exists
        if 'Shipment ID' not in main_data.columns and 'shipmentId' not in main_data.columns:
            print("❌ Error: Could not find 'Shipment ID' or 'shipmentId' column in main_data")
            print(f"Available columns: {', '.join(main_data.columns)}")
            return None
        
        # Select only required columns that exist in the CSV
        available_cols = [col for col in required_col if col in main_data.columns]
        if available_cols:
            main_data = main_data.loc[:, available_cols]
        
        # Rename columns
        rename_dict = {k: v for k, v in col_rename.items() if k in main_data.columns}
        main_data = main_data.rename(columns=rename_dict)
        
        # Clean date columns: strip whitespace and convert to %Y-%m-%d format
        date_columns = ['Creating Date', 'Receiving Date', 'Shipping Date', 'Closed Date']
        for col in date_columns:
            if col in main_data.columns:
                # Strip whitespace
                main_data[col] = main_data[col].astype(str).str.strip()
                
                # Replace empty strings, 'nan', 'None', 'NaT' with None
                mask_empty = main_data[col].isin(['', 'nan', 'None', 'NaT', 'NaN', 'None'])
                main_data.loc[mask_empty, col] = None
                
                # Convert to datetime - handle DD-MM-YYYY HH:MM:SS UTC format
                # Use dayfirst=True to correctly parse DD-MM-YYYY format
                # This handles dates like "14-12-2025 10:45:57 UTC"
                def parse_date(value):
                    if pd.isna(value) or value is None:
                        return None
                    
                    val_str = str(value).strip()
                    if val_str.lower() in ['', 'nan', 'none', 'nat', 'none']:
                        return None
                    
                    try:
                        # Parse with dayfirst=True to handle DD-MM-YYYY format
                        # This is crucial for dates like "14-12-2025" (14th December, not 14th month)
                        dt = pd.to_datetime(val_str, dayfirst=True, errors='coerce', utc=True)
                        if pd.notna(dt):
                            # Format as %Y-%m-%d
                            return dt.strftime('%Y-%m-%d')
                        return None
                    except Exception as e:
                        # If parsing fails, try without UTC
                        try:
                            dt = pd.to_datetime(val_str, dayfirst=True, errors='coerce')
                            if pd.notna(dt):
                                return dt.strftime('%Y-%m-%d')
                        except:
                            pass
                        return None
                
                # Apply date parsing
                main_data[col] = main_data[col].apply(parse_date)
        
        # Clean Shipment ID column - strip whitespace and remove empty values
        main_data['Shipment ID'] = main_data['Shipment ID'].astype(str).str.strip()
        main_data = main_data[main_data['Shipment ID'] != '']
        main_data = main_data[main_data['Shipment ID'] != 'nan']
        main_data = main_data[main_data['Shipment ID'].notna()]
        
        # Get unique Shipment IDs
        unique_shipments = set(main_data['Shipment ID'].unique())
        
        print(f"✅ Loaded {len(main_data)} rows")
        print(f"✅ Found {len(unique_shipments)} unique Shipment IDs")
        print(f"✅ Columns included: {', '.join(main_data.columns)}")
        
        return main_data, unique_shipments
        
    except Exception as e:
        print(f"❌ Error loading main_data: {e}")
        import traceback
        traceback.print_exc()
        return None


def load_country_data(excel_path, sheet_name):
    """Load country-specific data from Excel worksheet"""
    try:
        print(f"\n📂 Loading country data from sheet '{sheet_name}'...")
        
        # Read Excel sheet
        country_data = pd.read_excel(excel_path, sheet_name=sheet_name)
        
        # Check if 'Reference No.' column exists (try variations)
        ref_col = None
        possible_cols = ['Reference No.', 'Reference No', 'ReferenceNo', 'reference_no', 'Reference_No','Shipment ID']
        
        for col in possible_cols:
            if col in country_data.columns:
                ref_col = col
                break
        
        if ref_col is None:
            print("❌ Error: Could not find 'Reference No.' column in country data")
            print(f"Available columns: {', '.join(country_data.columns)}")
            return None
        
        # Find status column (try variations)
        status_col = None
        possible_status_cols = ['Status', 'Shipment Status', 'ShipmentStatus', 'status', 'shipment_status', 
                               'Shipment_Status', 'Current Status', 'CurrentStatus']
        
        for col in possible_status_cols:
            if col in country_data.columns:
                status_col = col
                break
        
        # Clean Reference No. column - strip whitespace and remove empty values
        country_data[ref_col] = country_data[ref_col].astype(str).str.strip()
        country_data = country_data[country_data[ref_col] != '']
        country_data = country_data[country_data[ref_col] != 'nan']
        country_data = country_data[country_data[ref_col].notna()]
        
        # Clean status column if found
        if status_col:
            country_data[status_col] = country_data[status_col].astype(str).str.strip()
            country_data[status_col] = country_data[status_col].replace(['', 'nan', 'None', 'NaT', 'NaN'], None)
        
        # Get unique Reference Nos
        unique_refs = set(country_data[ref_col].unique())
        
        print(f"✅ Loaded {len(country_data)} rows from sheet '{sheet_name}'")
        print(f"✅ Found {len(unique_refs)} unique Reference Nos")
        if status_col:
            print(f"✅ Found status column: '{status_col}'")
        else:
            print(f"⚠️  Warning: Could not find status column in country data")
        
        return country_data, unique_refs, ref_col, status_col
        
    except Exception as e:
        print(f"❌ Error loading country data: {e}")
        import traceback
        traceback.print_exc()
        return None


def find_missing_shipments(main_shipments, country_refs):
    """Find Shipment IDs that are in main_data but not in country file"""
    missing = main_shipments - country_refs
    return sorted(list(missing))


def find_status_changes(main_data, country_data, ref_col, status_col):
    """Find Shipment IDs whose status changed between raw file and country file"""
    if status_col is None or 'Shipment Status' not in main_data.columns:
        print("⚠️  Cannot compare status: Status column not found in one or both files")
        return None
    
    # Create a mapping from country file: Reference No. -> Status
    # Use the first occurrence if there are duplicates
    country_status_map = {}
    for _, row in country_data.iterrows():
        ref_no = str(row[ref_col]).strip()
        status = str(row[status_col]).strip() if pd.notna(row[status_col]) else None
        if ref_no and ref_no not in country_status_map:
            country_status_map[ref_no] = status
    
    # Compare with main_data
    status_changes = []
    
    # Group main_data by Shipment ID to get unique status per shipment
    main_data_grouped = main_data.groupby('Shipment ID').first().reset_index()
    
    for _, row in main_data_grouped.iterrows():
        shipment_id = str(row['Shipment ID']).strip()
        raw_status = str(row['Shipment Status']).strip() if pd.notna(row['Shipment Status']) else None
        
        # Check if this shipment exists in country file
        if shipment_id in country_status_map:
            country_status = country_status_map[shipment_id]
            
            # Normalize statuses for comparison (case-insensitive, strip whitespace)
            raw_status_norm = raw_status.lower().strip() if raw_status else None
            country_status_norm = country_status.lower().strip() if country_status else None
            
            # Check if status changed
            if raw_status_norm != country_status_norm:
                status_changes.append(shipment_id)
    
    return sorted(list(set(status_changes))) if status_changes else []


def create_output(missing_shipments, main_data, country_sheet, output_path=None, status_changes=None, country_data=None, ref_col=None, status_col=None):
    """Create output file with missing Shipment IDs and all required columns"""
    if not missing_shipments and not status_changes:
        print("\n✅ No missing Shipment IDs or status changes found!")
        return None
    
    # Generate output filename if not provided
    if output_path is None:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_path = f"missing_shipments_{country_sheet}_{timestamp}.xlsx"
    
    # Ensure .xlsx extension
    output_path = Path(output_path)
    if output_path.suffix.lower() != '.xlsx':
        output_path = output_path.with_suffix('.xlsx')
    
    # Write to Excel
    try:
        with pd.ExcelWriter(output_path, engine='openpyxl') as writer:
            # Include all columns from main_data (all required_col after renaming)
            # Keep all available columns, ensuring Shipment ID is first
            output_columns = ['Shipment ID']
            
            # Add all other columns from main_data (excluding Shipment ID if already added)
            for col in main_data.columns:
                if col != 'Shipment ID' and col not in output_columns:
                    output_columns.append(col)
            
            # Sheet 1: Missing Shipments
            if missing_shipments:
                # Create DataFrame with missing Shipment IDs and their details from main_data
                missing_df = main_data[main_data['Shipment ID'].isin(missing_shipments)].copy()
                
                # Select only columns that exist in missing_df
                available_output_cols = [col for col in output_columns if col in missing_df.columns]
                missing_df = missing_df[available_output_cols]
                
                # Sort by Shipment ID and SKU to keep all SKUs for each Shipment ID
                sort_cols = ['Shipment ID']
                if 'SKU' in missing_df.columns:
                    sort_cols.append('SKU')
                missing_df = missing_df.sort_values(sort_cols)
                
                missing_df.to_excel(writer, sheet_name='Missing Shipments', index=False)
            
            # Sheet 2: Status Changes
            if status_changes:
                # Create DataFrame with status changed Shipment IDs and their details from main_data
                status_changes_df = main_data[main_data['Shipment ID'].isin(status_changes)].copy()
                
                # Add country file status for comparison
                if country_data is not None and ref_col and status_col:
                    # Create mapping from country file
                    country_status_map = {}
                    for _, row in country_data.iterrows():
                        ref_no = str(row[ref_col]).strip()
                        status = str(row[status_col]).strip() if pd.notna(row[status_col]) else None
                        if ref_no and ref_no not in country_status_map:
                            country_status_map[ref_no] = status
                    
                    # Add country status column
                    status_changes_df['Country File Status'] = status_changes_df['Shipment ID'].map(
                        lambda x: country_status_map.get(str(x).strip(), 'Not Found')
                    )
                    
                    # Rename Shipment Status to Raw File Status for clarity
                    if 'Shipment Status' in status_changes_df.columns:
                        status_changes_df = status_changes_df.rename(columns={'Shipment Status': 'Raw File Status'})
                
                # Build column order: Shipment ID, Raw File Status, Country File Status, then all others
                ordered_cols = ['Shipment ID']
                
                # Add Raw File Status if it exists (should be right after Shipment ID)
                if 'Raw File Status' in status_changes_df.columns:
                    ordered_cols.append('Raw File Status')
                
                # Add Country File Status if it exists
                if 'Country File Status' in status_changes_df.columns:
                    ordered_cols.append('Country File Status')
                
                # Add all other columns from output_columns that exist in status_changes_df
                for col in output_columns:
                    if col != 'Shipment ID' and col not in ordered_cols and col in status_changes_df.columns:
                        ordered_cols.append(col)
                
                # Select columns in the correct order
                status_changes_df = status_changes_df[ordered_cols]
                
                # Sort by Shipment ID and SKU
                sort_cols = ['Shipment ID']
                if 'SKU' in status_changes_df.columns:
                    sort_cols.append('SKU')
                status_changes_df = status_changes_df.sort_values(sort_cols)
                
                status_changes_df.to_excel(writer, sheet_name='Status Changes', index=False)
            
            # Create summary sheet
            summary_metrics = ['Country Sheet', 'Generated On']
            summary_values = [country_sheet, datetime.now().strftime("%Y-%m-%d %H:%M:%S")]
            
            if missing_shipments:
                missing_df_count = len(main_data[main_data['Shipment ID'].isin(missing_shipments)])
                summary_metrics.extend(['Total Missing Shipment IDs (Unique)', 'Total Missing Rows (All SKUs)'])
                summary_values.extend([len(missing_shipments), missing_df_count])
            
            if status_changes:
                status_changes_df_count = len(main_data[main_data['Shipment ID'].isin(status_changes)])
                summary_metrics.extend(['Total Status Changed Shipment IDs (Unique)', 'Total Status Changed Rows (All SKUs)'])
                summary_values.extend([len(status_changes), status_changes_df_count])
            
            summary_data = {
                'Metric': summary_metrics,
                'Value': summary_values
            }
            summary_df = pd.DataFrame(summary_data)
            summary_df.to_excel(writer, sheet_name='Summary', index=False)
        
        print(f"\n✅ Output file created: {output_path}")
        if missing_shipments:
            missing_df_count = len(main_data[main_data['Shipment ID'].isin(missing_shipments)])
            print(f"   - Unique Missing Shipment IDs: {len(missing_shipments)}")
            print(f"   - Total missing rows (including all SKUs): {missing_df_count}")
        if status_changes:
            status_changes_df_count = len(main_data[main_data['Shipment ID'].isin(status_changes)])
            print(f"   - Unique Status Changed Shipment IDs: {len(status_changes)}")
            print(f"   - Total status changed rows (including all SKUs): {status_changes_df_count}")
        return str(output_path)
        
    except Exception as e:
        print(f"❌ Error creating output file: {e}")
        import traceback
        traceback.print_exc()
        return None


def process_files(main_data_path, country_file_path, sheet_name, output_path=None):
    """Process files - core processing logic"""
    # Load main_data
    main_data_result = load_main_data(main_data_path)
    if main_data_result is None:
        return None
    main_data, main_shipments = main_data_result
    
    # Load country data
    country_data_result = load_country_data(country_file_path, sheet_name)
    if country_data_result is None:
        return None
    country_data, country_refs, ref_col, status_col = country_data_result
    
    # Find missing shipments
    print(f"\n{'='*60}")
    print("COMPARING SHIPMENT IDs...")
    print('='*60)
    
    missing_shipments = find_missing_shipments(main_shipments, country_refs)
    
    print(f"\n📊 Comparison Results:")
    print(f"   - Total Shipment IDs in main_data: {len(main_shipments)}")
    print(f"   - Total Reference Nos in {sheet_name}: {len(country_refs)}")
    print(f"   - Missing Shipment IDs: {len(missing_shipments)}")
    print(f"   - Found in both: {len(main_shipments & country_refs)}")
    
    # Find status changes
    print(f"\n{'='*60}")
    print("COMPARING STATUS CHANGES...")
    print('='*60)
    
    status_changes = find_status_changes(main_data, country_data, ref_col, status_col)
    
    if status_changes is not None:
        print(f"\n📊 Status Comparison Results:")
        print(f"   - Shipment IDs with status changes: {len(status_changes)}")
        if status_changes:
            print(f"   - First 10 changed Shipment IDs: {status_changes[:10]}")
    else:
        status_changes = []
    
    # Create output
    if missing_shipments or status_changes:
        print(f"\n{'='*60}")
        print("CREATING OUTPUT FILE...")
        print('='*60)
        
        output_file = create_output(
            missing_shipments if missing_shipments else [], 
            main_data, 
            sheet_name,
            output_path=output_path,
            status_changes=status_changes if status_changes else [],
            country_data=country_data,
            ref_col=ref_col,
            status_col=status_col
        )
        
        return output_file
    else:
        print("\n✅ All Shipment IDs from main_data are present in the country file!")
        print("✅ No status changes detected!")
        return None


def main():
    """Main function - supports both interactive and command-line modes"""
    parser = argparse.ArgumentParser(
        description='Amazon Shipment Tracker - Missing Shipment ID Finder',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        '-m', '--main-data',
        help='Path to main_data CSV file (optional for interactive mode)'
    )
    parser.add_argument(
        '-c', '--country-file',
        help='Path to country-specific Excel file (optional for interactive mode)'
    )
    parser.add_argument(
        '-s', '--sheet',
        help='Country worksheet name (optional for interactive mode)'
    )
    parser.add_argument(
        '-o', '--output',
        help='Output Excel file path (optional)'
    )
    
    args = parser.parse_args()
    
    print("\n" + "="*60)
    print("  AMAZON SHIPMENT TRACKER - MISSING SHIPMENT ID FINDER")
    print("="*60)
    
    # If command-line arguments provided, use them
    if args.main_data and args.country_file and args.sheet:
        if not Path(args.main_data).exists():
            print(f"❌ Error: Main data file does not exist: {args.main_data}")
            sys.exit(1)
        if not Path(args.country_file).exists():
            print(f"❌ Error: Country file does not exist: {args.country_file}")
            sys.exit(1)
        
        output_file = process_files(args.main_data, args.country_file, args.sheet, args.output)
        
        if output_file:
            print(f"\n{'='*60}")
            print("  PROCESS COMPLETE!")
            print('='*60)
            print(f"\n📁 Output file: {output_file}")
        return
    
    # Otherwise, use interactive mode
    # Get main_data file path
    main_data_path = get_file_path("Enter path to main_data CSV file:")
    if not main_data_path:
        print("❌ No main_data file provided. Exiting.")
        return
    
    # Get country Excel file path
    country_file_path = get_file_path("Enter path to country-specific Excel file:")
    if not country_file_path:
        print("❌ No country file provided. Exiting.")
        return
    
    # Get available sheets
    sheets = get_available_sheets(country_file_path)
    if not sheets:
        print("❌ Could not read Excel file sheets. Exiting.")
        return
    
    # Select country sheet
    selected_sheet = select_country_sheet(sheets)
    if not selected_sheet:
        print("❌ No sheet selected. Exiting.")
        return
    
    print(f"\n✅ Selected country sheet: {selected_sheet}")
    
    # Process files
    output_file = process_files(main_data_path, country_file_path, selected_sheet)
    
    if output_file:
        print(f"\n{'='*60}")
        print("  PROCESS COMPLETE!")
        print('='*60)
        print(f"\n📁 Output file: {output_file}")
        print(f"\n💡 Tip: Open the Excel file to see detailed information.")
        print(f"   - 'Missing Shipments' worksheet: Shipments not found in country file")
        print(f"   - 'Status Changes' worksheet: Shipments with status changes")
    
    print()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nOperation cancelled by user.")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

