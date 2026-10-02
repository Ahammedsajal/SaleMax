const fs = require("fs");
const path = require("path");

// Path to license file
const LICENSE_FILE = process.env.SALEMAX_LICENSE_FILE || path.join(__dirname, "./license.json");

/**
 * Middleware to check license
 */
const checkLicense = async (req, res, next) => {
  try {
    if (fs.existsSync(LICENSE_FILE)) {
      // License exists → allow
      return next();
    }

    // License missing → block
    return res.json({
      success: false,
      msg: "License verification needed",
      licenseRequired: true,
    });
  } catch (err) {
    console.error("License check error:", err);
    return res.json({
      success: false,
      msg: "Unable to verify the license",
    });
  }
};

/**
 * Function to create license file
 * Can be called after validating license via your API
 */
const createLicenseFile = (data = {}) => {
  try {
    const licenseData = {
      activatedAt: new Date().toISOString(),
      domain: data.domain || null,
      product: data.product || "whatscrm",
    };

    fs.mkdirSync(path.dirname(LICENSE_FILE), { recursive: true });
    const temporary = `${LICENSE_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(licenseData, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, LICENSE_FILE);
    console.log("License file created ✅");
  } catch (err) {
    console.error("Error creating license file:", err);
    throw err;
  }
};

module.exports = { checkLicense, createLicenseFile };
