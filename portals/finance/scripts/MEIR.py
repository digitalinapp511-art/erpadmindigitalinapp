#!/usr/bin/env python3
"""
MEIR (Finance) - Inventory Reconciliation Script
==================================================
Processes inventory data from multiple sources and creates a consolidated MEIR report.

Usage:
    python MEIR.py --india-platform <file> --usa-platform <file> --three-g <file> 
                   --shipcube <file> --updike <file> --amazon <file> --container <file> 
                   --output <file>
"""

import pandas as pd
import numpy as np
import os
import sys
import argparse
from datetime import datetime, timedelta
from dateutil.relativedelta import relativedelta
from pathlib import Path

# Set UTF-8 encoding for stdout/stderr to handle special characters
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')


# =============================================================================
# UTILITY FUNCTIONS
# =============================================================================

def get_short_path(full_path):
    r"""
    Convert full path to shortened path relative to 'Central Repository'.
    
    Example:
        Input:  C:\Users\...\Central Repository\inventory\india\output\file.xlsx
        Output: Central Repository\inventory\india\output\file.xlsx
    """
    full_path = str(full_path)
    if "Central Repository" in full_path:
        idx = full_path.find("Central Repository")
        return full_path[idx:]
    return os.path.basename(full_path)


def display_path(file_path, label="File"):
    """Display file path in shortened format"""
    short_path = get_short_path(file_path)
    print(f"  {label}: {short_path}")


# =============================================================================
# DATE CONFIGURATION
# =============================================================================

def get_date_strings():
    """Calculate and return all required date strings for the analysis."""
    today = pd.to_datetime("today")
    
    datestr_T = today.strftime("%d-%b-%Y")  # Today
    datestr = (today - timedelta(1)).strftime("%d-%b-%Y")  # Yesterday
    datestr2 = (today - timedelta(2)).strftime("%d-%b-%Y")  # 2 days ago
    current_month = today.strftime("%b-%Y")  # Current month
    
    # Previous month
    previous_month_date = datetime.now() - relativedelta(months=1)
    datestr_month_L = previous_month_date.strftime("%b-%Y")
    
    return {
        'today': datestr_T,
        'yesterday': datestr,
        'two_days_ago': datestr2,
        'current_month': current_month,
        'previous_month': datestr_month_L
    }


# =============================================================================
# DATA LOADING FUNCTIONS
# =============================================================================

def load_india_others(india_platform_file):
    """Load India Others data (Flipkart and Easy Ecomm)"""
    print("\n📥 Loading India Others data...")
    display_path(india_platform_file, "India Platform file")
    
    flipkart = pd.read_excel(india_platform_file, sheet_name='Flipkart')
    easyecom = pd.read_excel(india_platform_file, sheet_name='Easy Ecomm')
    
    # Define the selected columns for each dataframe
    cols = ['Date', 'Platform', 'SKU', 'On_Hand']
    
    # Concatenate the dataframes
    india_others = pd.concat([flipkart[cols], easyecom[cols]])
    india_others.reset_index(drop=True, inplace=True)
    
    print(f"  ✅ Loaded {len(india_others)} rows")
    return india_others


def load_usa_others(usa_platform_file, datestr):
    """Load USA Others data (Walmart only - 3G and Updike are loaded separately)"""
    print("\n📥 Loading USA Others data...")
    display_path(usa_platform_file, "USA Platform file")
    
    # Try both possible sheet name variations (case-insensitive)
    try:
        Walmart = pd.read_excel(usa_platform_file, sheet_name='Walmart_invntory')
    except:
        try:
            Walmart = pd.read_excel(usa_platform_file, sheet_name='walmart_invntory')
        except Exception as e:
            print(f"  ❌ Error: Could not find Walmart sheet. Available sheets:")
            xl_file = pd.ExcelFile(usa_platform_file)
            for sheet in xl_file.sheet_names:
                print(f"     - {sheet}")
            raise Exception(f"Walmart sheet not found: {e}")
    
    # Define the selected columns
    cols = ['Date', 'Platform', 'SKU', 'On_Hand']
    
    # Return Walmart data (3G and Updike will be added separately in process_meir)
    usa_others = Walmart[cols].copy()
    usa_others.reset_index(drop=True, inplace=True)
    
    print(f"  ✅ Loaded {len(usa_others)} rows")
    return usa_others


def load_3g(three_g_file, datestr):
    """Load 3G warehouse data"""
    print("\n📥 Loading 3G data...")
    display_path(three_g_file, "3G file")
    
    three_G = pd.read_excel(three_g_file, sheet_name='3G-Inventory')
    
    # Filter columns and rename
    three_G = three_G.loc[:, ['SKU', '3G On Hand', 'Date', 'Box / Case']]
    three_G['Platform'] = '3G'
    three_G.reset_index(drop=True, inplace=True)
    three_G['On_Hand'] = three_G['3G On Hand'] * three_G['Box / Case']
    
    cols = ['Date', 'Platform', 'SKU', 'On_Hand']
    three_G = three_G[cols]
    
    print(f"  ✅ Loaded {len(three_G)} rows")
    return three_G


def load_shipcube(shipcube_file, datestr):
    """Load Shipcube data"""
    print("\n📥 Loading Shipcube data...")
    display_path(shipcube_file, "Shipcube file")
    
    shipcube = pd.read_excel(shipcube_file, sheet_name='Inventory_S-D')
    
    # Filter columns
    shipcube = shipcube.loc[:, ['SKU', 'Shipcube-East', 'Shipcube-West']]
    
    # Melt the dataframe to convert wide to long format
    shipcube_melted = pd.melt(
        shipcube,
        id_vars=['SKU'],
        value_vars=['Shipcube-East', 'Shipcube-West'],
        var_name='Platform',
        value_name='On_Hand'
    )
    
    shipcube_melted.reset_index(drop=True, inplace=True)
    shipcube_melted['SKU'] = np.where(
        shipcube_melted['SKU'] == '32OZ Soup Bowl Lid Set of 300', 
        'CBFL32OZ300', 
        shipcube_melted['SKU']
    )
    shipcube_melted['SKU'] = np.where(
        shipcube_melted['SKU'] == '32OZ', 
        'CBFL32OZ300', 
        shipcube_melted['SKU']
    )
    
    shipcube_melted['Date'] = datestr
    
    print(f"  ✅ Loaded {len(shipcube_melted)} rows")
    return shipcube_melted


def load_updike(updike_file, datestr):
    """Load Updike warehouse data"""
    print("\n📥 Loading Updike data...")
    display_path(updike_file, "Updike file")
    
    updike = pd.read_excel(updike_file, sheet_name='Updk-Inveto')
    
    # Filter columns and rename
    updike = updike.loc[:, ['SKU', 'Updike On Hand', 'Date', 'Box / Case']]
    updike['Platform'] = 'Updike'
    updike['On_Hand'] = updike['Updike On Hand'] * updike['Box / Case']
    updike.reset_index(drop=True, inplace=True)
    
    cols = ['Date', 'Platform', 'SKU', 'On_Hand']
    updike = updike[cols]
    
    print(f"  ✅ Loaded {len(updike)} rows")
    return updike


def load_amazon_data(amazon_file, datestr_T):
    """Load Amazon data (USA/Canada and Others)"""
    print("\n📥 Loading Amazon data...")
    display_path(amazon_file, "Amazon Inventory Database file")
    
    usa = pd.read_excel(amazon_file)
    
    country_1 = ['USA', 'Canada']
    usa = usa[usa['Country'].isin(country_1)]
    usa = usa.loc[:, ['SKU', 'Country', 'afn-warehouse-quantity', 'Date']]
    usa.rename(columns={'afn-warehouse-quantity': 'On_Hand'}, inplace=True)
    usa.reset_index(drop=True, inplace=True)
    
    amz_other = pd.read_excel(amazon_file)
    country_2 = ['USA', 'Canada']
    amz_other = amz_other[~amz_other['Country'].isin(country_2)]
    amz_other = amz_other.loc[:, ['SKU', 'Country', 'afn-warehouse-quantity', 'Date']]
    amz_other.rename(columns={'afn-warehouse-quantity': 'On_Hand'}, inplace=True)
    amz_other.reset_index(drop=True, inplace=True)
    
    Amazon_overall = pd.merge(
        usa, amz_other, 
        on=['SKU', 'Country', 'On_Hand', 'Date'], 
        how="outer"
    )
    
    print(f"  ✅ Loaded {len(Amazon_overall)} rows")
    return Amazon_overall


def load_container_data(container_file, current_date):
    """Load container data and calculate ageing"""
    print("\n📥 Loading Container data...")
    display_path(container_file, "Container Data file")
    
    columns_to_read = ['SKU', 'QTY in Box', 'Month_Year', 'Status']
    container = pd.read_excel(
        container_file, 
        sheet_name='Container SKU', 
        usecols=columns_to_read
    )
    
    container['Month_Year'] = container['Month_Year'].apply(
        lambda x: pd.to_datetime(x).strftime("%b-%Y") 
        if pd.to_datetime(x, errors='coerce') is not pd.NaT else None
    )
    
    container = container.drop(container[container.Status != "Reached"].index)
    
    # Calculate previous months
    current_month_minus_1 = (current_date - relativedelta(months=1)).strftime("%b-%Y")
    current_month_minus_2 = (current_date - relativedelta(months=2)).strftime("%b-%Y")
    current_month_minus_3 = (current_date - relativedelta(months=3)).strftime("%b-%Y")
    current_month_minus_4 = (current_date - relativedelta(months=4)).strftime("%b-%Y")
    
    # Define function to assign 'Ageing'
    def calculate_ageing(month_year):
        if month_year == current_month_minus_1:
            return 'current_month_minus_1'
        elif month_year == current_month_minus_2:
            return 'current_month_minus_2'
        elif month_year == current_month_minus_3:
            return 'current_month_minus_3'
        elif month_year == current_month_minus_4:
            return 'current_month_minus_4'
        else:
            return 'Outside range'
    
    container['Ageing'] = container['Month_Year'].apply(calculate_ageing)
    container = container.drop(container[container.Ageing == "Outside range"].index)
    
    container_data = pd.pivot_table(
        container, 
        index="SKU", 
        columns="Ageing", 
        values="QTY in Box", 
        aggfunc='sum', 
        fill_value=0
    ).reset_index()
    
    print(f"  ✅ Loaded {len(container_data)} SKUs")
    return container_data


# =============================================================================
# MAIN PROCESSING FUNCTION
# =============================================================================

def process_meir(input_files, output_file):
    """
    Main function to process all data and create MEIR report.
    
    Args:
        input_files: Dictionary with all input file paths
        output_file: Output file path
    """
    print("\n" + "="*60)
    print("  MEIR (Finance) - Inventory Reconciliation")
    print("="*60)
    
    # Get date strings
    dates = get_date_strings()
    datestr_T = dates['today']
    datestr = dates['yesterday']
    current_month = dates['current_month']
    current_date = datetime.now()
    
    print(f"\n📅 Date Configuration:")
    print(f"  Today: {datestr_T}")
    print(f"  Yesterday: {datestr}")
    print(f"  Current Month: {current_month}")
    
    # Load all data
    print("\n" + "="*60)
    print("  LOADING DATA")
    print("="*60)
    
    india_others = load_india_others(input_files['india_platform'])
    usa_others = load_usa_others(input_files['usa_platform'], datestr)
    three_G = load_3g(input_files['three_g'], datestr)
    shipcube_melted = load_shipcube(input_files['shipcube'], datestr)
    updike = load_updike(input_files['updike'], datestr)
    Amazon_overall = load_amazon_data(input_files['amazon'], datestr_T)
    container_data = load_container_data(input_files['container'], current_date)
    
    # Combine all dataframes
    print("\n" + "="*60)
    print("  PROCESSING DATA")
    print("="*60)
    
    print("\n📊 Combining all data sources...")
    # Combine USA others: Walmart + 3G + Updike
    usa_others_combined = pd.concat([
        usa_others,
        three_G[['Date', 'Platform', 'SKU', 'On_Hand']],
        updike[['Date', 'Platform', 'SKU', 'On_Hand']]
    ])
    usa_others_combined = usa_others_combined.drop_duplicates()
    
    # Combine all sources
    MEIR_dataframe = pd.concat([
        india_others, 
        usa_others_combined,
        shipcube_melted, 
        Amazon_overall
    ])
    
    MEIR_dataframe['Country'] = np.where(
        MEIR_dataframe['Country'].isnull(), 
        MEIR_dataframe['Platform'], 
        MEIR_dataframe['Country']
    )
    
    # Create pivot table
    print("  Creating pivot table...")
    MEIR_dataframe = pd.pivot_table(
        MEIR_dataframe, 
        index=['Date', "SKU"], 
        columns="Country", 
        values="On_Hand", 
        aggfunc='sum'
    ).reset_index()
    
    MEIR_dataframe = MEIR_dataframe.fillna(0)
    MEIR_dataframe = MEIR_dataframe.drop(
        MEIR_dataframe[MEIR_dataframe.SKU == '0'].index
    )
    
    # Select required columns
    required_cols = [
        'Date', 'SKU', '3G', 'Updike', 'Shipcube-East', 'Shipcube-West', 
        'Walmart', 'USA', 'Canada', 'Germany', 'UAE', 'UK', 
        'Easy Ecom', 'Flipkart', 'India'
    ]
    available_cols = [col for col in required_cols if col in MEIR_dataframe.columns]
    MEIR_dataframe = MEIR_dataframe.loc[:, available_cols]
    
    # Aggregate by SKU (remove Date dimension)
    print("  Aggregating by SKU...")
    value_cols = [
        '3G', 'Updike', 'Walmart', 'Shipcube-East', 'Shipcube-West', 
        'USA', 'Canada', 'Germany', 'UAE', 'UK', 'Easy Ecom', 'Flipkart', 'India'
    ]
    available_value_cols = [col for col in value_cols if col in MEIR_dataframe.columns]
    
    MEIR_dataframe = pd.pivot_table(
        MEIR_dataframe, 
        index="SKU", 
        values=available_value_cols, 
        aggfunc='sum'
    ).reset_index()
    
    # Calculate Total Inventory X India
    print("  Calculating totals...")
    total_cols = [
        '3G', 'Updike', 'Walmart', 'USA', 'Canada', 'Germany', 
        'UAE', 'UK', 'Shipcube-East', 'Shipcube-West'
    ]
    available_total_cols = [col for col in total_cols if col in MEIR_dataframe.columns]
    MEIR_dataframe['Total Inventory X India'] = MEIR_dataframe[available_total_cols].sum(axis=1)
    
    # Merge container data
    print("  Merging container data...")
    MEIR_dataframe = pd.merge(MEIR_dataframe, container_data, on='SKU', how='left')
    MEIR_dataframe = MEIR_dataframe.fillna(0)
    
    # Save to Excel
    print("\n" + "="*60)
    print("  SAVING OUTPUT")
    print("="*60)
    
    print(f"\n💾 Saving to: {get_short_path(output_file)}")
    MEIR_dataframe.to_excel(output_file, index=False)
    
    print(f"\n✅ MEIR report saved successfully!")
    print(f"   Total SKUs: {len(MEIR_dataframe)}")
    print(f"   Total columns: {len(MEIR_dataframe.columns)}")
    
    return MEIR_dataframe


# =============================================================================
# MAIN FUNCTION
# =============================================================================

def main():
    """Main function with command-line argument parsing"""
    parser = argparse.ArgumentParser(
        description='MEIR (Finance) - Inventory Reconciliation Script',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Example usage:
  python MEIR.py --india-platform india.xlsx --usa-platform usa.xlsx \\
                 --three-g 3g.xlsx --shipcube shipcube.xlsx --updike updike.xlsx \\
                 --amazon amazon.xlsx --container container.xlsx --output output.xlsx
        """
    )
    
    parser.add_argument(
        '--india-platform',
        type=str,
        required=True,
        help='Path to India Platform file (contains Flipkart and Easy Ecomm sheets)'
    )
    
    parser.add_argument(
        '--usa-platform',
        type=str,
        required=True,
        help='Path to USA Platform file (contains Walmart_invntory sheet)'
    )
    
    parser.add_argument(
        '--three-g',
        type=str,
        required=True,
        help='Path to 3G Warehouse Database file'
    )
    
    parser.add_argument(
        '--shipcube',
        type=str,
        required=True,
        help='Path to Inventory Database file (for Shipcube data, sheet: Inventory_S-D)'
    )
    
    parser.add_argument(
        '--updike',
        type=str,
        required=True,
        help='Path to Updike Warehouse Database file'
    )
    
    parser.add_argument(
        '--amazon',
        type=str,
        required=True,
        help='Path to Amazon Inventory Database file (Overall Supply Chain Inventory)'
    )
    
    parser.add_argument(
        '--container',
        type=str,
        required=True,
        help='Path to Container Data file'
    )
    
    parser.add_argument(
        '--output',
        type=str,
        required=True,
        help='Path to output Excel file'
    )
    
    args = parser.parse_args()
    
    # Validate all input files exist
    input_files = {
        'india_platform': args.india_platform,
        'usa_platform': args.usa_platform,
        'three_g': args.three_g,
        'shipcube': args.shipcube,
        'updike': args.updike,
        'amazon': args.amazon,
        'container': args.container
    }
    
    for key, file_path in input_files.items():
        if not os.path.exists(file_path):
            print(f"❌ Error: File does not exist: {file_path}")
            sys.exit(1)
    
    # Process data
    try:
        result_df = process_meir(input_files, args.output)
        print("\n" + "="*60)
        print("  PROCESSING COMPLETE!")
        print("="*60)
        print(f"\n📁 Output file: {get_short_path(args.output)}")
        print(f"📊 Total rows: {len(result_df)}")
        print(f"📊 Total columns: {len(result_df.columns)}")
        print("\n✅ All done!")
        
    except Exception as e:
        print(f"\n❌ Error processing data: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()





























