/** English labels exactly as the app sends/receives them (enum values of spec section 3, translated). */
const PROPERTY_TYPE = ['Multifamily', 'Single-Family', 'Commercial', 'Mixed-Use', 'Land'];
const EXPENSE_CATEGORY = ['Property Tax', 'Insurance', 'Utilities', 'Repairs & Maintenance', 'Management', 'Marketing', 'Loan Interest', 'Legal Fees', 'Capital Improvements'];
const PRIORITY = ['Urgent', 'High', 'Normal'];

module.exports = {
  STRATEGY: ['Stable Cash Flow', 'Value-Add', 'Development', 'Commercial'],
  PROPERTY_TYPE,
  PROPERTY_STATUS: ['Owned', 'Managed', 'For Sale', 'Sold'],
  UNIT_TYPE: ['Studio', '1 Bedroom', '2 Bedroom', '3 Bedroom', 'Commercial Space'],
  UNIT_STATUS: ['Occupied', 'Vacant', 'Notice Given', 'Under Repair', 'Off Market'],
  FURNISH: ['Unfurnished', 'Partially Furnished', 'Furnished'],
  LEASE_KIND: ['Annual', 'Month-to-Month', 'Commercial'],
  LEASE_STATUS: ['Upcoming', 'Active', 'Expiring Soon', 'Expired', 'Renewed', 'Terminated'],
  RENT_STATUS: ['Unpaid', 'Partially Paid', 'Paid in Full', 'Overdue'],
  WO_CATEGORY: ['Plumbing', 'Electrical', 'HVAC', 'Appliances', 'Roofing', 'Landscaping', 'Fire Safety', 'Other'],
  PRIORITY,
  WO_STATUS: ['New', 'Assigned', 'In Progress', 'Waiting for Parts', 'Completed', 'Cancelled'],
  VENDOR_SERVICE: ['Electrical', 'Plumbing', 'Roofing', 'Construction', 'Landscaping', 'Cleaning', 'Security', 'HVAC'],
  VENDOR_STATUS: ['Active', 'On Hold'],
  INSPECTION_ITEM: ['Roofing', 'Structure', 'Electrical System', 'Plumbing & Drainage', 'HVAC', 'Fire Safety', 'Elevator', 'Parking Lot', 'Landscaping'],
  INSPECTION_RESULT: ['Good', 'Needs Monitoring', 'Urgent Repair'],
  RENO_STATUS: ['Planned', 'Permitting', 'Under Construction', 'Final Inspection', 'Completed', 'On Hold'],
  MILESTONE_STATUS: ['Pending', 'Done'],
  TASK_STATUS: ['To Do', 'In Progress', 'Done'],
  EXPENSE_CATEGORY,
  EXPENSE_NATURE: ['Operating', 'Capital'],
  LOAN_STATUS: ['Current', 'Refinancing', 'Paid Off'],
  RATE_KIND: ['Fixed', 'Floating'],
  REVENUE_KIND: ['Rent', 'Parking Fees', 'Laundry', 'Storage Fees', 'Other'],
  REVENUE_SOURCE: ['Manual Entry', 'Auto from Rent Collection'],
  TARGET_PERIOD: ['Month', 'Quarter', 'Year'],
  DEAL_SIDE: ['Buy', 'Sell'],
  DEAL_STAGE: ['Screening', 'Analysis', 'Offer', 'Due Diligence', 'Closed', 'Rejected'],
  CHECK_ITEM: ['Title & Ownership', 'Building Inspection', 'Environmental', 'Insurance', 'Existing Leases', 'Tax', 'Financing'],
  CHECK_STATUS: ['Not Checked', 'Passed', 'Issue Found'],
  SALE_KIND: ['Property Sale', 'Unit Lease', 'Lease Renewal', 'Acquisition'],
  SALE_PRODUCT: ['Studio', '1 Bedroom', '2 Bedroom', '3 Bedroom', 'Commercial Space', 'Single-Family', 'Land', 'Whole Property'],
  PARTNER_KIND: ['Bank & Lender', 'Broker', 'Property Manager', 'Insurance Company', 'Tax Firm', 'Attorney', 'Title Insurance', 'Contractor'],
  REPORT_STATUS: ['Pending Review', 'Resolved'],
  HISTORY_ACTION: ['create', 'update', 'delete', 'restore'],

  // groups used by the business rules (spec 6.1)
  OCCUPIED_UNIT: ['Occupied', 'Notice Given'],
  ACTIVE_LEASE: ['Active', 'Expiring Soon'],
  OPEN_WO: ['New', 'Assigned', 'In Progress', 'Waiting for Parts'],
  CLOSED_DEAL: ['Closed', 'Rejected'],
  NON_OPEX: ['Loan Interest', 'Capital Improvements'],
};
