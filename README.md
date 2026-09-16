# Enterprise B2B Procurement & Multi-Tier Approval Workflow Engine

[![Node.js](https://img.shields.io/badge/Node.js-v18+-green.svg)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express.js-4.x-lightgrey.svg)](https://expressjs.com/)
[![MySQL](https://img.shields.io/badge/MySQL-8.0+-blue.svg)](https://www.mysql.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An enterprise-grade B2B procurement backend service designed to automate vendor purchase order processing, enforce financial governance, and maintain audit integrity. Built with **Node.js**, **Express**, and **MySQL**, the system eliminates unauthorized corporate spending through threshold-based policy routing, ACID-compliant database operations, and immutable state-change tracking.

---

## 📌 Architectural Overview & Business Problem

Standard retail e-commerce architectures follow a single-tier checkout model. In contrast, corporate B2B procurement requires strict enterprise spending controls, segregation of duties, and compliance auditing:

1. **Uncontrolled Operational Expenditure:** Without automated limits, high-value purchase orders bypass executive visibility.
2. **Audit & Compliance Gaps:** Regulated industries require a verifiable historical record showing who authorized an order, when the approval occurred, and the prior state.
3. **Data Integrity Hazards:** Network failures or concurrent review actions can create orphan records, race conditions, or mismatched inventory/procurement states.

### Core Solution
This engine implements:
* **Spend Policy Engine:** High-value purchase orders exceeding **₹50,000** are dynamically flagged for managerial authorization (`PENDING_APPROVAL`), while standard operational purchases are auto-routed (`AUTO_APPROVED`).
* **ACID Transaction Boundary:** All status transitions, order creation steps, and ledger modifications execute within atomic database transactions (`BEGIN`, `COMMIT`, `ROLLBACK`).
* **Tamper-Proof Audit Logging:** State modifications are automatically mirrored in an immutable audit ledger (`po_approval_logs`) capturing approver identity, comments, timestamps, and state diffs.

---

## 🏗️ System Architecture & Workflow State Machine

```text
[ Client / ERP Client ]
          │
          ▼
   POST /api/orders
          │
          ├──> [ Policy Engine Check: Total > ₹50,000? ]
          │          │
          │          ├─── (No)  ──> Status: 'AUTO_APPROVED' ──┐
          │          │                                        │
          │          └─── (Yes) ──> Status: 'PENDING_APPROVAL'│
          │                                                   │
          ▼                                                   ▼
 [ MySQL: purchase_orders ] <───────────── [ Atomic Transaction: COMMIT ]
          │
          ▼
 [ State Machine Trigger ]
          │
  PATCH /api/orders/:id/review (Manager Action: APPROVED / REJECTED)
          │
          ├──> Acquire Row-Level Lock (`FOR UPDATE`)
          ├──> Verify State Preconditions (Must be 'PENDING_APPROVAL')
          ├──> Update `purchase_orders.status`
          └──> Write Immutable Entry to `po_approval_logs`
