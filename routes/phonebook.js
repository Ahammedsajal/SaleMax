const router = require("express").Router();
const { query } = require("../database/dbpromise.js");
const randomstring = require("randomstring");
const bcrypt = require("bcrypt");
const {
  isValidEmail,
  areMobileNumbersFilled,
} = require("../functions/function.js");
const { sign } = require("jsonwebtoken");
const validateUser = require("../middlewares/user.js");
const csv = require("csv-parser");
const fs = require("fs");
const { checkPlan, checkContactLimit } = require("../middlewares/plan.js");
const phonebookOwnerScope=require('../modules/platform/phonebook-owner-scope').middleware({pool:require('../database/config.js').promise()});
const phonebookImport = require('../modules/platform/phonebook-import');

// add phonebook name
router.post(
  "/add",
  validateUser,
  phonebookOwnerScope,
  checkPlan,
  checkContactLimit,
  async (req, res) => {
    try {
      const { name } = req.body;

      if (!name) {
        return res.json({
          success: false,
          msg: "Please enter a phonebook name",
        });
      }

      // find ext
      const findExt = await query(
        `SELECT * FROM phonebook WHERE uid = ? AND name = ?`,
        [req.decode.uid, name]
      );

      if (findExt.length > 0) {
        return res.json({
          success: false,
          msg: "Duplicate phonebook name found",
        });
      }

      await query(`INSERT INTO phonebook (name, uid) VALUES (?,?)`, [
        name,
        req.decode.uid,
      ]);
      res.json({ success: true, msg: "Phonebook was addedd" });
    } catch (err) {
      res.json({ success: false, msg: "something went wrong" });
      console.log(err);
    }
  }
);

// get by uid
router.get("/get_by_uid", validateUser, phonebookOwnerScope, async (req, res) => {
  try {
    if(req.phonebookReadContext){
      const db=await require('../database/config').promise().getConnection();
      try{return res.json({data:await require('../modules/platform/phonebook-workspace').books(db,req.phonebookReadContext),success:true});}
      finally{db.release();}
    }
    let data = await query(`SELECT * FROM phonebook WHERE uid = ?`, [
      req.decode.uid,
    ]);

    data = await Promise.all(
      data.map(async (x) => {
        const [result] = await query(
          `SELECT COUNT(*) AS count FROM contact WHERE phonebook_id = ? AND uid = ?`,
          [x.id, req.decode.uid]
        );
        return { ...x, contactCount: result.count };
      })
    );

    res.json({ data, success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false, msg: "Something went wrong" });
  }
});

// Edit Contact
router.put("/edit_contact", validateUser, phonebookOwnerScope, async (req, res) => {
  const { contactId, name, mobile, var1, var2, var3, var4, var5, var6 } = req.body;

  try {
    // Update contact in the database
    const result = await query(
      `UPDATE contact SET name = ?, mobile = ?, var1 = ?, var2 = ?, var3 = ?, var4 = ?, var5 = ?, var6 = ? WHERE id = ? AND uid = ?`,
      [
        name,
        mobile,
        var1,
        var2,
        var3,
        var4,
        var5,
        var6,
        contactId,
        req.decode.uid,
      ]
    );

    if (result.affectedRows > 0) {
      res.json({ success: true, msg: "Contact updated successfully" });
    } else {
      res.json({ success: false, msg: "Contact not found or no changes made" });
    }
  } catch (err) {
    console.error(err);
    res.json({ success: false, msg: "Something went wrong" });
  }
});

// del a phonebook
router.post("/del_phonebook", validateUser, phonebookOwnerScope, async (req, res) => {
  try {
    const { id } = req.body;
    const result = await query(`DELETE FROM phonebook WHERE id = ? AND uid = ?`, [id,req.decode.uid]);
    if(!result.affectedRows)return res.status(404).json({success:false,code:'PHONEBOOK_NOT_FOUND'});
    await query(`DELETE FROM contact WHERE phonebook_id = ? AND uid = ?`, [id,req.decode.uid]);

    res.json({ success: true, msg: "Phonebook was deleted" });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    console.log(err);
  }
});

function parseCSVFile(fileData) {
  return new Promise((resolve, reject) => {
    const results = [];

    // Check if file data is provided
    if (!fileData) {
      resolve(null);
      return;
    }

    const stream = require("stream");
    const bufferStream = new stream.PassThrough();

    // Convert file data (Buffer) to a readable stream
    bufferStream.end(fileData);

    // Use csv-parser to parse the CSV data
    bufferStream
      .pipe(csv({ mapHeaders: ({ header }) => phonebookImport.normalizeHeader(header) }))
      .on("data", (data) => {
        // Push each row of data to the results array
        results.push(data);
      })
      .on("end", () => {
        // Resolve the promise with the parsed CSV data
        resolve(results);
      })
      .on("error", (error) => {
        // Reject the promise if there is an error
        resolve(null);
      });
  });
}

// import contcats
router.post(
  "/import_contacts",
  validateUser,
  phonebookOwnerScope,
  checkPlan,
  checkContactLimit,
  async (req, res) => {
    try {
      if (!req.files || Object.keys(req.files).length === 0) {
        return res.json({ success: false, msg: "No files were uploaded" });
      }

      const { id, phonebook_name } = req.body;
      const [phonebook] = await query(`SELECT id FROM phonebook WHERE id = ? AND uid = ? LIMIT 1`,[id,req.decode.uid]);
      if(!phonebook)return res.status(404).json({success:false,code:'PHONEBOOK_NOT_FOUND'});

      const csvData = await parseCSVFile(req.files.file.data);
      if (!csvData) {
        return res.json({ success: false, msg: "Invalid CSV provided" });
      }

      // Contacts without a number can be catalogued, but campaign/call routes
      // explicitly exclude them from recipient lists.
      const normalizedRows = phonebookImport.normalizeImportRows(csvData);
      const values = normalizedRows.map((item) => [
        req.decode.uid, // assuming uid is available in each item
        id,
        phonebook_name,
        ...item,
      ]);

      // Execute the query
      await query(
        `INSERT INTO contact (uid, phonebook_id, phonebook_name, name, mobile, var1, var2, var3, var4, var5) VALUES ?`,
        [values]
      );

      res.json({ success: true, msg: "Contacts were inserted", imported: values.length, withoutMobile: normalizedRows.filter((row) => !row[1]).length });
    } catch (err) {
      if (err.code === 'INVALID_CONTACT_IMPORT' || err.code === 'INVALID_CONTACT_IMPORT_ROW' || err.code === 'CONTACT_FIELD_TOO_LONG') {
        return res.status(400).json({ success: false, code: err.code, row: err.row });
      }
      res.json({ success: false, msg: "something went wrong" });
      console.log(err);
    }
  }
);

// add single contact
router.post(
  "/add_single_contact",
  validateUser,
  phonebookOwnerScope,
  checkPlan,
  checkContactLimit,
  async (req, res) => {
    try {
      const { id, phonebook_name, mobile, name, var1, var2, var3, var4, var5 } =
        req.body;

      if (!mobile) {
        return res.json({ success: false, msg: "Mobile number is required" });
      }

      const [phonebook] = await query(`SELECT id FROM phonebook WHERE id = ? AND uid = ? LIMIT 1`,[id,req.decode.uid]);
      if(!phonebook)return res.status(404).json({success:false,code:'PHONEBOOK_NOT_FOUND'});

      await query(
        `INSERT INTO contact (uid, phonebook_id, phonebook_name, name, mobile, var1, var2, var3, var4, var5) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          req.decode.uid,
          id,
          phonebook_name,
          name,
          mobile,
          var1,
          var2,
          var3,
          var4,
          var5,
        ]
      );

      res.json({ success: true, msg: "Contact was inserted" });
    } catch (err) {
      res.json({ success: false, msg: "something went wrong" });
      console.log(err);
    }
  }
);

// get contacts using uid
router.get("/get_uid_contacts", validateUser, phonebookOwnerScope, async (req, res) => {
  try {
    if(req.phonebookReadContext){
      const scope=require('../modules/platform/phonebook-workspace').visibility(req.phonebookReadContext);
      const data=await query(`SELECT c.* FROM contact c WHERE ${scope.sql}`,scope.params);
      return res.json({data,success:true});
    }
    const data = await query(`SELECT * FROM contact WHERE uid = ?`, [
      req.decode.uid,
    ]);
    res.json({ data, success: true });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    console.log(err);
  }
});

// dele contcats
router.post("/del_contacts", validateUser, phonebookOwnerScope, async (req, res) => {
  try {
    const selected=req.body?.selected;
    if(!Array.isArray(selected)||!selected.length||selected.length>500||selected.some(id=>!Number.isSafeInteger(Number(id))||Number(id)<1))return res.status(400).json({success:false,code:'INVALID_CONTACT_SELECTION'});
    await query(`DELETE FROM contact WHERE id IN (?) AND uid = ?`, [selected,req.decode.uid]);
    res.json({ success: true, msg: "Contact(s) was deleted" });
  } catch (err) {
    res.json({ success: false, msg: "something went wrong" });
    console.log(err);
  }
});

module.exports = router;
