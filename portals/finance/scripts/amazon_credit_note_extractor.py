#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Amazon Credit Note PDF Extractor
=================================
Processes Amazon credit note PDFs and extracts header info and service line items.

Usage:
    # Process a folder of PDFs
    python amazon_credit_note_extractor.py -i "path/to/credit_notes" -o "path/to/output.xlsx"
    
    # Process a single PDF file
    python amazon_credit_note_extractor.py -i "path/to/credit_note.pdf" -o "path/to/output.xlsx"
    
    # Interactive mode (will prompt for paths)
    python amazon_credit_note_extractor.py
"""

import pandas as pd
import numpy as np
import pdfplumber
import re
import os
import sys
import argparse
from pathlib import Path
from datetime import datetime

# Set UTF-8 encoding for stdout/stderr to handle special characters
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')


# =============================================================================
# EXTRACTION FUNCTIONS
# =============================================================================

def extract_header_info(text):
    """Extract header information from Credit Note PDF using regex."""
    header_data = {
        'Credit Note Date': None,
        'Credit Note Number': None,
        'GST Tax Registration No': None,
        'CIN No': None,
        'Place of Supply': None,
        'GSTIN': None,
        'Reason for Credit': None
    }
    
    patterns = {
        'Credit Note Date': r'Credit Note Date[:\s]*(\d{2}/\d{2}/\d{4})',
        'Credit Note Number': r'Credit Note Number[:\s]*([A-Z0-9\-]+)',
        'GST Tax Registration No': r'GST Tax Registration No[:\s]*([A-Z0-9]+)',
        'CIN No': r'CIN No[:\s]*([A-Z0-9]+)',
        'Place of Supply': r'Place of Supply[:\s]*([A-Za-z\s]+?)(?:\n|State)',
        'GSTIN': r'GSTIN[:\s]*([A-Z0-9]+)',
        'Reason for Credit': r'Reason for Credit[:\s]*([^\n]+)'
    }
    
    for field, pattern in patterns.items():
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            header_data[field] = match.group(1).strip()
    
    return header_data


def extract_first_table(pdf):
    """
    Extract first summary table from Credit Note PDF.
    Table columns: SI No | Orig Invoice No | Orig Invoice Date | Category | Description | Tax Rate | Amount
    
    Uses FLEXIBLE detection (no hardcoded service names):
    - Serial number in first cell
    - SAC code (6-digit) in category column
    - Original Invoice Number pattern (e.g., DL-2526-72113)
    - Valid description + INR amount
    """
    table_data = []
    table_ended = False
    captured_si_numbers = set()
    
    for page in pdf.pages:
        if table_ended:
            break
            
        tables = page.extract_tables()
        if not tables:
            continue
            
        for table in tables:
            if table_ended:
                break
                
            for row in table:
                if not row or len(row) < 6:
                    continue
                
                if not any(cell for cell in row if cell):
                    continue
                
                row_text = ' '.join([str(cell) if cell else '' for cell in row])
                
                # End of table
                if 'Total:' in row_text or (row_text.strip().startswith('Total') and 'INR' in row_text):
                    table_ended = True
                    break
                
                # Skip tax rows
                if 'SGST' in row_text or 'CGST' in row_text:
                    continue
                
                # Skip header rows
                if 'SI No' in row_text or 'Category of Service' in row_text:
                    continue
                
                # Skip subtotal rows
                if 'Subtotal' in row_text:
                    continue
                
                # Get cell values (7 columns)
                first_cell = str(row[0]).strip() if row[0] else ''
                orig_invoice = str(row[1]).strip() if len(row) > 1 and row[1] else ''
                description = str(row[4]).strip() if len(row) > 4 and row[4] else ''
                category = str(row[3]).strip() if len(row) > 3 and row[3] else ''
                amount_cell = str(row[6]).strip() if len(row) > 6 and row[6] else ''
                
                is_service_row = False
                
                # Method 1: Serial number in first cell
                first_cell_digits = re.sub(r'[^\d]', '', first_cell)
                if first_cell_digits and len(first_cell_digits) <= 2:
                    if first_cell_digits not in captured_si_numbers:
                        is_service_row = True
                        captured_si_numbers.add(first_cell_digits)
                
                # Method 2: SAC code (6-digit number like 996729)
                if not is_service_row and category.isdigit() and len(category) == 6:
                    if description and len(description) > 3:
                        is_service_row = True
                
                # Method 3: Original Invoice Number pattern (e.g., DL-2526-72113)
                if not is_service_row and orig_invoice:
                    if re.match(r'^[A-Z]{2}-\d+-\d+$', orig_invoice):
                        if description and len(description) > 3 and 'INR' in amount_cell:
                            if 'SGST' not in description and 'CGST' not in description:
                                is_service_row = True
                
                # Method 4: Valid description + INR amount (flexible)
                if not is_service_row:
                    if description and len(description) > 5 and 'INR' in amount_cell:
                        if 'SGST' not in description and 'CGST' not in description and 'GST' not in description:
                            is_service_row = True
                
                if is_service_row:
                    table_data.append(row)
    
    return table_data


def parse_service_table(table_data):
    """Parse raw Credit Note table data into structured format."""
    parsed_data = []
    running_si_no = 0
    
    for row in table_data:
        cleaned_row = [str(cell).strip() if cell else '' for cell in row]
        
        description = cleaned_row[4] if len(cleaned_row) > 4 else ''
        amount = cleaned_row[6] if len(cleaned_row) > 6 else ''
        
        # Handle multiline descriptions
        description = description.replace('\n', ' ').strip()
        
        if not description:
            continue
        
        # Determine SI No
        first_cell = cleaned_row[0]
        if first_cell and first_cell.replace('.', '').strip().isdigit():
            si_no = first_cell.replace('.', '').strip()
            running_si_no = int(si_no)
        else:
            running_si_no += 1
            si_no = str(running_si_no)
        
        service_entry = {
            'SI No': si_no,
            'Original Invoice Number': cleaned_row[1] if len(cleaned_row) > 1 else '',
            'Original Invoice Date': cleaned_row[2] if len(cleaned_row) > 2 else '',
            'Category of Service': cleaned_row[3] if len(cleaned_row) > 3 else '',
            'Description of Service': description,
            'Amount': amount
        }
        parsed_data.append(service_entry)
    
    return parsed_data


def process_single_pdf(pdf_path):
    """Process a single Credit Note PDF file."""
    try:
        with pdfplumber.open(pdf_path) as pdf:
            first_page_text = pdf.pages[0].extract_text()
            header_info = extract_header_info(first_page_text)
            header_info['Source File'] = os.path.basename(pdf_path)
            
            raw_table = extract_first_table(pdf)
            parsed_table = parse_service_table(raw_table)
            
            return header_info, parsed_table
            
    except Exception as e:
        # Return None to indicate failure, error will be logged by caller
        return None, None


def process_amounts(df):
    """Process Amount column: remove INR prefix, add SGST, CGST, Total."""
    df = df.copy()
    
    # Handle credit note amounts (can be negative like "-INR 399.50")
    df['Amount'] = df['Amount'].astype(str).str.replace('-INR\n', '-', regex=False)
    df['Amount'] = df['Amount'].str.replace('INR ', '', regex=False)
    df['Amount'] = df['Amount'].str.replace(',', '').str.strip()
    df['Amount'] = df['Amount'].str.replace('-', '', regex=False)
    df['Amount'] = pd.to_numeric(df['Amount'], errors='coerce').fillna(0)
    
    df['SGST (9%)'] = (df['Amount'] * 0.09).round(2)
    df['CGST (9%)'] = (df['Amount'] * 0.09).round(2)
    df['Total Amount'] = (df['Amount'] + df['SGST (9%)'] + df['CGST (9%)']).round(2)
    
    # Forward fill Original Invoice Number and Date for continuity
    df['Original Invoice Number'] = df['Original Invoice Number'].replace(r'^\s*$', pd.NA, regex=True)
    df['Original Invoice Date'] = df['Original Invoice Date'].replace(r'^\s*$', pd.NA, regex=True)
    df['Original Invoice Number'] = df['Original Invoice Number'].ffill()
    df['Original Invoice Date'] = df['Original Invoice Date'].ffill()
    
    return df


def process_all_pdfs(input_path):
    """Process all PDF files from input path (file or folder)."""
    all_headers = []
    all_table_data = []
    
    # Track processing status for each file
    processed_files = []  # Successfully processed
    excluded_files = []   # Failed or excluded
    
    input_path = Path(input_path)
    
    # Determine if input is file or folder
    if input_path.is_file():
        if input_path.suffix.lower() != '.pdf':
            print(f"Error: {input_path} is not a PDF file")
            return None, None, [], [(str(input_path), "Not a PDF file")]
        pdf_files = [input_path]
    elif input_path.is_dir():
        pdf_files = list(input_path.glob("*.pdf"))
    else:
        print(f"Error: {input_path} does not exist")
        return None, None, [], [(str(input_path), "Path does not exist")]
    
    if not pdf_files:
        print("No PDF files found to process")
        return None, None, [], []
    
    print(f"\n{'='*60}")
    print(f"Found {len(pdf_files)} PDF file(s) to process")
    print('='*60)
    
    for i, pdf_path in enumerate(pdf_files, 1):
        print(f"\n[{i}/{len(pdf_files)}] Processing: {pdf_path.name}")
        
        try:
            header_info, table_data = process_single_pdf(str(pdf_path))
        except Exception as e:
            excluded_files.append((pdf_path.name, f"Processing error: {str(e)}"))
            print(f"  [ERROR] Exception occurred: {str(e)}")
            continue
        
        if header_info:
            # Check if we got valid data
            credit_note_num = header_info.get('Credit Note Number', '')
            
            if not credit_note_num:
                excluded_files.append((pdf_path.name, "Missing Credit Note Number"))
                print(f"  [WARNING] Excluded: Missing Credit Note Number")
                continue
            
            if not table_data:
                excluded_files.append((pdf_path.name, "No service line items found"))
                print(f"  [WARNING] Excluded: No service line items found")
                continue
            
            all_headers.append(header_info)
            
            for row in table_data:
                row['Credit Note Number'] = credit_note_num
                row['Credit Note Date'] = header_info.get('Credit Note Date', '')
                all_table_data.append(row)
            
            processed_files.append((pdf_path.name, credit_note_num, len(table_data)))
            print(f"  [OK] Credit Note #{credit_note_num} ({len(table_data)} line items)")
        else:
            excluded_files.append((pdf_path.name, "Failed to extract header data"))
            print(f"  [ERROR] Failed to extract data")
    
    # Print summary
    print(f"\n{'='*60}")
    print(f"PROCESSING SUMMARY")
    print('='*60)
    print(f"  ✓ Successfully processed: {len(processed_files)} file(s)")
    print(f"  ✗ Excluded/Failed: {len(excluded_files)} file(s)")
    
    # Show excluded files if any
    if excluded_files:
        print(f"\n{'─'*60}")
        print("⚠ EXCLUDED FILES:")
        print('─'*60)
        for filename, reason in excluded_files:
            print(f"  • {filename}")
            print(f"    Reason: {reason}")
    
    print('='*60)
    
    if not all_headers:
        return None, None, processed_files, excluded_files
    
    # Create DataFrames
    headers_df = pd.DataFrame(all_headers)
    table_df = pd.DataFrame(all_table_data)
    
    # Reorder columns
    header_columns = ['Source File', 'Credit Note Number', 'Credit Note Date', 
                      'GST Tax Registration No', 'CIN No', 'Place of Supply', 'GSTIN', 'Reason for Credit']
    headers_df = headers_df[[col for col in header_columns if col in headers_df.columns]]
    
    table_columns = ['Credit Note Number', 'Credit Note Date', 'Original Invoice Number', 
                     'Original Invoice Date', 'Description of Service', 'Amount']
    table_df = table_df[[col for col in table_columns if col in table_df.columns]]
    
    return headers_df, table_df, processed_files, excluded_files


def export_to_excel(headers_df, table_df, output_path, processed_files, excluded_files):
    """Export DataFrames to Excel with multiple sheets."""
    # Process amounts
    table_df = process_amounts(table_df)
    
    # Create main filer (merged data)
    main_filer = pd.merge(table_df, headers_df, on=['Credit Note Number', 'Credit Note Date'], how='left').ffill()
    if 'Place of Supply' in main_filer.columns:
        main_filer['Place of Supply'] = main_filer['Place of Supply'].str.title()
    
    # Create QC pivot table
    credit_note_qc = pd.pivot_table(
        main_filer, 
        index='Credit Note Number', 
        columns='Credit Note Date', 
        values='Total Amount', 
        aggfunc='sum'
    ).reset_index()
    
    # Create processing summary DataFrame
    summary_data = []
    for filename, credit_note_num, line_items in processed_files:
        summary_data.append({
            'File Name': filename,
            'Status': 'Processed',
            'Credit Note Number': credit_note_num,
            'Line Items': line_items,
            'Reason': ''
        })
    for filename, reason in excluded_files:
        summary_data.append({
            'File Name': filename,
            'Status': 'Excluded',
            'Credit Note Number': '',
            'Line Items': 0,
            'Reason': reason
        })
    summary_df = pd.DataFrame(summary_data)
    
    # Export
    with pd.ExcelWriter(output_path, engine='openpyxl') as writer:
        headers_df.to_excel(writer, sheet_name='Credit_Note_Headers', index=False)
        table_df.to_excel(writer, sheet_name='Service_Line_Items', index=False)
        main_filer.to_excel(writer, sheet_name='Main_Filer', index=False)
        credit_note_qc.to_excel(writer, sheet_name='Credit_Note_QC', index=False)
        summary_df.to_excel(writer, sheet_name='Processing_Summary', index=False)
    
    return len(headers_df), len(table_df)


def get_input_interactive():
    """Get input/output paths interactively from user."""
    print("\n" + "="*60)
    print("  AMAZON CREDIT NOTE PDF EXTRACTOR")
    print("="*60)
    
    # Get input path
    print("\nEnter the path to your PDF file or folder containing PDFs:")
    print("(You can drag & drop the file/folder here)")
    input_path = input("\n> ").strip().strip('"').strip("'")
    
    if not input_path:
        print("Error: No input path provided")
        return None, None
    
    # Validate input path
    input_path = Path(input_path)
    if not input_path.exists():
        print(f"Error: Path does not exist: {input_path}")
        return None, None
    
    # Get output path
    print("\nEnter the output Excel file path (or press Enter for default):")
    print(f"Default: {input_path.parent / 'extracted_credit_notes.xlsx'}")
    output_path = input("\n> ").strip().strip('"').strip("'")
    
    if not output_path:
        output_path = input_path.parent / 'extracted_credit_notes.xlsx'
    else:
        output_path = Path(output_path)
        # Ensure .xlsx extension
        if output_path.suffix.lower() != '.xlsx':
            output_path = output_path.with_suffix('.xlsx')
    
    return str(input_path), str(output_path)


def main():
    """Main function to run the extractor."""
    parser = argparse.ArgumentParser(
        description='Amazon Credit Note PDF Extractor',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Process a folder of PDFs
  python amazon_credit_note_extractor.py -i "C:/CreditNotes" -o "C:/Output/credit_notes.xlsx"
  
  # Process a single PDF file  
  python amazon_credit_note_extractor.py -i "C:/credit_note.pdf" -o "C:/output.xlsx"
  
  # Interactive mode (will prompt for paths)
  python amazon_credit_note_extractor.py
        """
    )
    
    parser.add_argument(
        '-i', '--input',
        type=str,
        help='Input PDF file or folder path'
    )
    
    parser.add_argument(
        '-o', '--output',
        type=str,
        help='Output Excel file path'
    )
    
    args = parser.parse_args()
    
    # Determine input/output paths
    if args.input and args.output:
        input_path = args.input
        output_path = args.output
    elif args.input:
        input_path = args.input
        output_path = str(Path(args.input).parent / 'extracted_credit_notes.xlsx')
    else:
        # Interactive mode
        input_path, output_path = get_input_interactive()
        if not input_path:
            sys.exit(1)
    
    # Ensure output has .xlsx extension
    if not output_path.lower().endswith('.xlsx'):
        output_path += '.xlsx'
    
    # Process PDFs
    headers_df, table_df, processed_files, excluded_files = process_all_pdfs(input_path)
    
    if headers_df is None or table_df is None:
        if excluded_files:
            print(f"\n⚠ All {len(excluded_files)} file(s) were excluded. No data to export.")
        else:
            print("\nNo data extracted. Exiting.")
        sys.exit(1)
    
    # Export to Excel
    print(f"\nExporting to: {output_path}")
    num_notes, num_items = export_to_excel(headers_df, table_df, output_path, processed_files, excluded_files)
    
    print(f"\n{'='*60}")
    print("  EXPORT COMPLETE!")
    print('='*60)
    print(f"\n📁 Output file: {output_path}")
    print(f"\n📊 Summary:")
    print(f"   - {num_notes} credit note(s) processed")
    print(f"   - {num_items} service line item(s) extracted")
    if excluded_files:
        print(f"   - {len(excluded_files)} file(s) excluded (see 'Processing_Summary' sheet)")
    print(f"\n📑 Excel Sheets Created:")
    print(f"   - 'Credit_Note_Headers': Credit note header information")
    print(f"   - 'Service_Line_Items': Service breakdown with SGST/CGST/Total")
    print(f"   - 'Main_Filer': Complete merged data")
    print(f"   - 'Credit_Note_QC': Summary pivot table")
    print(f"   - 'Processing_Summary': File processing status & excluded files")
    print()


if __name__ == "__main__":
    main()

