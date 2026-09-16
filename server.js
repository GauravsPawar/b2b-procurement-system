require('dotenv').config();
const express = require('express');
const pool = require('./db');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 4000;

// 1. Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'UP', message: 'B2B Procurement API running' });
});

// 2. Fetch Vendors
app.get('/api/vendors', async (req, res) => {
  try {
    const [vendors] = await pool.query('SELECT * FROM vendors');
    res.status(200).json({ success: true, data: vendors });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. Create a Purchase Order (ACID Transaction + Business Threshold Rule)
app.post('/api/po', async (req, res) => {
  const { vendor_id, item_description, quantity, unit_price, created_by } = req.body;

  // Basic Validation
  if (!vendor_id || !item_description || !quantity || !unit_price || !created_by) {
    return res.status(400).json({ success: false, message: 'All fields are required.' });
  }

  const total_amount = Number((quantity * unit_price).toFixed(2));
  
  // TBA Business Rule: Threshold Check
  const status = total_amount < 50000 ? 'AUTO_APPROVED' : 'PENDING_APPROVAL';
  const po_number = `PO-${Date.now()}`;

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // Insert Purchase Order
    const [poResult] = await connection.query(
      `INSERT INTO purchase_orders (po_number, vendor_id, item_description, quantity, unit_price, total_amount, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [po_number, vendor_id, item_description, quantity, unit_price, total_amount, status, created_by]
    );

    const poId = poResult.insertId;

    // Log the action in Audit Trail
    const auditAction = status === 'AUTO_APPROVED' ? 'AUTO_APPROVED' : 'CREATED';
    const auditComment = status === 'AUTO_APPROVED' 
      ? 'Order value under ₹50,000 threshold. Auto-approved by system.'
      : 'Order value meets/exceeds ₹50,000 threshold. Pending management approval.';

    await connection.query(
      `INSERT INTO po_approval_logs (po_id, action, reviewed_by, comments)
       VALUES (?, ?, ?, ?)`,
      [poId, auditAction, status === 'AUTO_APPROVED' ? 'SYSTEM' : created_by, auditComment]
    );

    await connection.commit();

    res.status(201).json({
      success: true,
      message: 'Purchase Order created successfully.',
      data: {
        po_id: poId,
        po_number,
        total_amount,
        status
      }
    });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ success: false, error: error.message });
  } finally {
    connection.release();
  }
});

// 4. Manager Approval / Rejection Endpoint
app.post('/api/po/:id/action', async (req, res) => {
  const { id } = req.params;
  const { action, reviewed_by, comments } = req.body;

  if (!['APPROVED', 'REJECTED'].includes(action) || !reviewed_by) {
    return res.status(400).json({ success: false, message: 'Invalid action or missing reviewer name.' });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // Verify PO exists and is pending
    const [rows] = await connection.query('SELECT status FROM purchase_orders WHERE id = ? FOR UPDATE', [id]);
    
    if (rows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Purchase Order not found.' });
    }

    if (rows[0].status !== 'PENDING_APPROVAL') {
      await connection.rollback();
      return res.status(400).json({ success: false, message: `Cannot modify PO with status ${rows[0].status}.` });
    }

    // Update Status
    await connection.query('UPDATE purchase_orders SET status = ? WHERE id = ?', [action, id]);

    // Insert Audit Trail
    await connection.query(
      `INSERT INTO po_approval_logs (po_id, action, reviewed_by, comments)
       VALUES (?, ?, ?, ?)`,
      [id, action, reviewed_by, comments || 'No comments provided.']
    );

    await connection.commit();

    res.status(200).json({
      success: true,
      message: `Purchase Order ${action.toLowerCase()} successfully.`,
      data: { po_id: id, updated_status: action }
    });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ success: false, error: error.message });
  } finally {
    connection.release();
  }
});

app.listen(PORT, () => {
  console.log(`Procurement server running on http://localhost:${PORT}`);
});