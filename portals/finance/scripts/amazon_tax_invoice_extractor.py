#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Amazon Tax Invoice PDF Extractor
================================
Processes Amazon tax invoice PDFs and extracts header info and service line items.

Usage:
    # Process a folder of PDFs
    python amazon_tax_invoice_extractor.py -i "path/to/invoices" -o "path/to/output.xlsx"
    
    # Process a single PDF file
    python amazon_tax_invoice_extractor.py -i "path/to/invoice.pdf" -o "path/to/output.xlsx"
    
    # Interactive mode (will prompt for paths)
    python amazon_tax_invoice_extractor.py
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
    """Extract header information from the PDF text using regex patterns."""
    header_data = {
        'Invoice Date': None,
        'Invoice Number': None,
        'GST Tax Registration No': None,
        'CIN No': None,
        'Place of Supply': None,
        'GSTIN': None
    }
    
    patterns = {
        'Invoice Date': r'Invoice Date[:\s]*(\d{2}/\d{2}/\d{4})',
        'Invoice Number': r'Invoice Number[:\s]*([A-Z0-9\-]+)',
        'GST Tax Registration No': r'GST Tax Registration No[:\s]*([A-Z0-9]+)',
        'CIN No': r'CIN No[:\s]*([A-Z0-9]+)',
        'Place of Supply': r'Place of Supply[:\s]*([A-Za-z\s]+?)(?:\n|State)',
        'GSTIN': r'GSTIN[:\s]*([A-Z0-9]+)'
    }
    
    for field, pattern in patterns.items():
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            header_data[field] = match.group(1).strip()
    
    return header_data


def extract_first_table(pdf):
    """
    Extract the first summary table from PDF.
    Uses FLEXIBLE detection (no hardcoded service names):
    - Serial number in first cell
    - SAC code (6-digit) in category column
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
                if not row or len(row) < 4:
                    continue
                
                if not any(cell for cell in row if cell):
                    continue
                
                row_text = ' '.join([str(cell) if cell else '' for cell in row])
                
                # End of table
                if 'Total:' in row_text:
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
                
                # Get cell values
                first_cell = str(row[0]).strip() if row[0] else ''
                second_cell = str(row[1]).strip() if len(row) > 1 and row[1] else ''
                third_cell = str(row[2]).strip() if len(row) > 2 and row[2] else ''
                amount_cell = str(row[4]).strip() if len(row) > 4 and row[4] else ''
                
                is_service_row = False
                
                # Method 1: Serial number in first cell
                first_cell_digits = re.sub(r'[^\d]', '', first_cell)
                if first_cell_digits and len(first_cell_digits) <= 2:
                    if first_cell_digits not in captured_si_numbers:
                        is_service_row = True
                        captured_si_numbers.add(first_cell_digits)
                
                # Method 2: SAC code (6-digit number)
                if not is_service_row and second_cell.isdigit() and len(second_cell) == 6:
                    if third_cell and len(third_cell) > 3:
                        is_service_row = True
                
                # Method 3: Valid description + INR amount (flexible)
                if not is_service_row:
                    if third_cell and len(third_cell) > 5 and 'INR' in amount_cell:
                        if 'SGST' not in third_cell and 'CGST' not in third_cell and 'GST' not in third_cell:
                            is_service_row = True
                
                if is_service_row:
                    table_data.append(row)
    
    return table_data


def parse_service_table(table_data):
    """Parse raw table data into structured format."""
    parsed_data = []
    running_si_no = 0
    
    for row in table_data:
        cleaned_row = [str(cell).strip() if cell else '' for cell in row]
        
        description = cleaned_row[2] if len(cleaned_row) > 2 else ''
        amount = cleaned_row[4] if len(cleaned_row) > 4 else ''
        
        if not description:
            continue
        
        first_cell = cleaned_row[0]
        if first_cell and first_cell.replace('.', '').strip().isdigit():
            si_no = first_cell.replace('.', '').strip()
            running_si_no = int(si_no)
        else:
            running_si_no += 1
            si_no = str(running_si_no)
        
        service_entry = {
            'SI No': si_no,
            'Category of Service': cleaned_row[1] if len(cleaned_row) > 1 else '',
            'Description of Service': description,
            'Amount': amount
        }
        parsed_data.append(service_entry)
    
    return parsed_data


def process_single_pdf(pdf_path):
    """Process a single PDF file."""
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
    df['Amount'] = df['Amount'].astype(str).str.replace('INR ', '', regex=False).str.replace(',', '').str.strip()
    df['Amount'] = pd.to_numeric(df['Amount'], errors='coerce').fillna(0)
    df['SGST (9%)'] = (df['Amount'] * 0.09).round(2)
    df['CGST (9%)'] = (df['Amount'] * 0.09).round(2)
    df['Total Amount'] = (df['Amount'] + df['SGST (9%)'] + df['CGST (9%)']).round(2)
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
            invoice_num = header_info.get('Invoice Number', '')
            
            if not invoice_num:
                excluded_files.append((pdf_path.name, "Missing Invoice Number"))
                print(f"  [WARNING] Excluded: Missing Invoice Number")
                continue
            
            if not table_data:
                excluded_files.append((pdf_path.name, "No service line items found"))
                print(f"  [WARNING] Excluded: No service line items found")
                continue
            
            all_headers.append(header_info)
            
            for row in table_data:
                row['Invoice Number'] = invoice_num
                row['Invoice Date'] = header_info.get('Invoice Date', '')
                all_table_data.append(row)
            
            processed_files.append((pdf_path.name, invoice_num, len(table_data)))
            print(f"  [OK] Invoice #{invoice_num} ({len(table_data)} line items)")
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
    header_columns = ['Source File', 'Invoice Number', 'Invoice Date', 
                      'GST Tax Registration No', 'CIN No', 'Place of Supply', 'GSTIN']
    headers_df = headers_df[[col for col in header_columns if col in headers_df.columns]]
    
    table_columns = ['Invoice Number', 'Invoice Date', 'Description of Service', 'Amount']
    table_df = table_df[[col for col in table_columns if col in table_df.columns]]
    
    return headers_df, table_df, processed_files, excluded_files


def export_to_excel(headers_df, table_df, output_path, processed_files, excluded_files):
    """Export DataFrames to Excel with multiple sheets."""
    # Process amounts
    table_df = process_amounts(table_df)
    
    # Create main filer (merged data)
    main_filer = pd.merge(table_df, headers_df, on=['Invoice Number', 'Invoice Date'], how='left').ffill()
    if 'Place of Supply' in main_filer.columns:
        main_filer['Place of Supply'] = main_filer['Place of Supply'].str.title()
    
    # Create QC pivot table
    invoice_qc = pd.pivot_table(
        main_filer, 
        index='Invoice Number', 
        columns='Invoice Date', 
        values='Total Amount', 
        aggfunc='sum'
    ).reset_index()
    
    # Create processing summary DataFrame
    summary_data = []
    for filename, invoice_num, line_items in processed_files:
        summary_data.append({
            'File Name': filename,
            'Status': 'Processed',
            'Invoice Number': invoice_num,
            'Line Items': line_items,
            'Reason': ''
        })
    for filename, reason in excluded_files:
        summary_data.append({
            'File Name': filename,
            'Status': 'Excluded',
            'Invoice Number': '',
            'Line Items': 0,
            'Reason': reason
        })
    summary_df = pd.DataFrame(summary_data)
    
    # Export
    with pd.ExcelWriter(output_path, engine='openpyxl') as writer:
        headers_df.to_excel(writer, sheet_name='Invoice_Headers', index=False)
        table_df.to_excel(writer, sheet_name='Service_Line_Items', index=False)
        main_filer.to_excel(writer, sheet_name='Main_Filer', index=False)
        invoice_qc.to_excel(writer, sheet_name='Invoice_QC', index=False)
        summary_df.to_excel(writer, sheet_name='Processing_Summary', index=False)
    
    return len(headers_df), len(table_df)


def main():
    """Main function to run the extractor."""
    parser = argparse.ArgumentParser(
        description='Amazon Tax Invoice PDF Extractor',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Process a folder of PDFs
  python amazon_tax_invoice_extractor.py -i "C:/Invoices" -o "C:/Output/invoices.xlsx"
  
  # Process a single PDF file  
  python amazon_tax_invoice_extractor.py -i "C:/invoice.pdf" -o "C:/output.xlsx"
  
  # Interactive mode (will prompt for paths)
  python amazon_tax_invoice_extractor.py
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
        output_path = str(Path(args.input).parent / 'extracted_invoices.xlsx')
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
    num_invoices, num_items = export_to_excel(headers_df, table_df, output_path, processed_files, excluded_files)
    
    print(f"\n{'='*60}")
    print("  EXPORT COMPLETE!")
    print('='*60)
    print(f"\n📁 Output file: {output_path}")
    print(f"\n📊 Summary:")
    print(f"   - {num_invoices} invoice(s) processed")
    print(f"   - {num_items} service line item(s) extracted")
    if excluded_files:
        print(f"   - {len(excluded_files)} file(s) excluded (see 'Processing_Summary' sheet)")
    print(f"\n📑 Excel Sheets Created:")
    print(f"   - 'Invoice_Headers': Invoice header information")
    print(f"   - 'Service_Line_Items': Service breakdown with SGST/CGST/Total")
    print(f"   - 'Main_Filer': Complete merged data")
    print(f"   - 'Invoice_QC': Summary pivot table")
    print(f"   - 'Processing_Summary': File processing status & excluded files")
    print()


def get_input_interactive():
    """Get input/output paths interactively from user."""
    print("\n" + "="*60)
    print("  AMAZON TAX INVOICE PDF EXTRACTOR")
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
    print(f"Default: {input_path.parent / 'extracted_invoices.xlsx'}")
    output_path = input("\n> ").strip().strip('"').strip("'")
    
    if not output_path:
        output_path = input_path.parent / 'extracted_invoices.xlsx'
    else:
        output_path = Path(output_path)
        # Ensure .xlsx extension
        if output_path.suffix.lower() != '.xlsx':
            output_path = output_path.with_suffix('.xlsx')
    
    return str(input_path), str(output_path)


if __name__ == "__main__":
    main()
