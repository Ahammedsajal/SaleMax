const jwt = require("jsonwebtoken");
const { query } = require("../database/dbpromise");

const validateAgent = async (req, res, next) => {
  try {
    const token = req.get("Authorization");
    if (!token) {
      return res.json({ msg: "No token found", token: token, logout: true });
    }

    jwt.verify(token.split(" ")[1], process.env.JWTKEY, async (err, decode) => {
      if (err) {
        return res.json({
          success: 0,
          msg: "Invalid token found, 499",
          token,
          logout: true,
        });
      } else {
        const getAgent = await query(
          `SELECT * FROM agents WHERE email = ? and password = ? `,
          [decode.email, decode.password]
        );

        if (getAgent.length < 1) {
          return res.json({
            success: false,
            msg: "Invalid token found, 480",
            token,
            logout: true,
          });
        }

        if (getAgent[0]?.is_active < 1) {
          return res.json({
            msg: "You are an inactive agent.",
            logout: true,
            success: false,
          });
        }

        // getting owner
        const getOwner = await query(`SELECT * FROM user WHERE uid = ?`, [
          getAgent[0]?.owner_uid,
        ]);

        if (getOwner.length < 1) {
          return res.json({
            msg: "Agent Owner not found",
            success: false,
          });
        }

        if (getAgent[0].role === "agent") {
          try { await require('../modules/platform/tenant-crm-domains').assertLegacyHost(query,req,'agents',getAgent[0].id); }
          catch (error) { return res.status(error.status||403).json({success:false,code:error.code||'CRM_DOMAIN_TENANT_MISMATCH'}); }
          req.owner = getOwner[0];
          req.decode = decode;
          req.decode.userData = getAgent[0];
          const roleGuard = require('../modules/platform/team-role-request-guard');
          let roleAccess;
          try { roleAccess = await roleGuard.authorizeLegacyRequest(req,{sourceTable:'agents',sourceId:getAgent[0].id}); }
          catch (_) { return res.status(503).json({success:false,code:'TEAM_ROLE_ACCESS_UNAVAILABLE'}); }
          if (!roleAccess.allowed) return res.status(403).json({success:false,code:roleAccess.code||'TEAM_ROLE_PERMISSION_DENIED'});
          next();
        } else {
          return res.json({
            success: 0,
            msg: "Unauthorized token",
            token: token,
            logout: true,
          });
        }
      }
    });
  } catch (err) {
    console.log(err);
    res.json({ msg: "server error", err });
  }
};

module.exports = validateAgent;
