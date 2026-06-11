/**
 * Finance tools registry (single source of truth).
 * This is intended for humans + wiring helpers.
 */

const TOOLS = [
  {
    id: 'amazon-tax-invoice',
    title: 'Amazon Tax Invoice',
    api: {
      processFolder: '/api/finance/tools/amazon-tax-invoice/process-folder',
      processFile: '/api/finance/tools/amazon-tax-invoice/process-file',
    },
    pythonScript: 'amazon_tax_invoice_extractor.py',
  },
  {
    id: 'amazon-credit-note',
    title: 'Amazon Credit Note',
    api: {
      processFolder: '/api/finance/tools/amazon-credit-note/process-folder',
      processFile: '/api/finance/tools/amazon-credit-note/process-file',
    },
    pythonScript: 'amazon_credit_note_extractor.py',
  },
  {
    id: 'book-reconcile',
    title: 'Book Reconcile',
    api: {
      processFolder: '/api/finance/tools/book-reconcile/process-folder',
      processFile: '/api/finance/tools/book-reconcile/process-file',
    },
    pythonScript: 'book_keeping_file_processing.py',
  },
  {
    id: 'gst-reconcile',
    title: 'GST Reconcile',
    api: {
      processFolder: '/api/finance/tools/gst-reconcile/process-folder',
      processFile: '/api/finance/tools/gst-reconcile/process-file',
    },
    pythonScript: 'gst_reconcile.py',
  },
  {
    id: 'books-vs-gst-reconciliation',
    title: 'Books vs GST Reconciliation',
    api: {
      processFolder: '/api/finance/tools/books-vs-gst-reconciliation/process-folder',
      processFile: '/api/finance/tools/books-vs-gst-reconciliation/process-file',
    },
    pythonScript: 'combined_gst_book_reconcile.py',
  },
  {
    id: 'amazon-pdf-merger',
    title: 'Amazon PDF Merger',
    api: {
      processFolder: '/api/finance/tools/amazon-pdf-merger/process-folder',
      processFile: '/api/finance/tools/amazon-pdf-merger/process-file',
    },
    pythonScript: null,
  },
];

module.exports = { TOOLS };

