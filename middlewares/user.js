const jwt = require("jsonwebtoken");
const { query } = require("../database/dbpromise");

const validateUser = async (req, res, next) => {
  try {
    const token = req.get("Authorization");
    if (!token) {
      return res.json({ msg: "No token found", token: token, logout: true });
    }

    jwt.verify(token.split(" ")[1], process.env.JWTKEY, async (err, decode) => {
      if (err) {
        return res.json({
          success: 0,
          msg: "Invalid token found",
          token,
          logout: true,
        });
      } else {
        try { await require('../modules/platform/delegated-account-session').assertDelegatedSession(query,decode); }
        catch (_) { return res.status(401).json({success:false,logout:true,msg:'Account session expired'}); }
        const getUser = await query(
          `SELECT * FROM user WHERE email = ? and password = ? `,
          [decode.email, decode.password]
        );
        if (getUser.length < 1) {
          return res.json({
            success: false,
            msg: "Invalid token found",
            token,
            logout: true,
          });
        }
        if (getUser[0].role === "user") {
          try { await require('../modules/platform/tenant-crm-domains').assertLegacyHost(query,req,'user',getUser[0].id); }
          catch (error) { return res.status(error.status||403).json({success:false,code:error.code||'CRM_DOMAIN_TENANT_MISMATCH'}); }
          req.decode = decode;
          req.decode.userData = getUser[0];
          const roleGuard = require('../modules/platform/team-role-request-guard');
          let roleAccess;
          try { roleAccess = await roleGuard.authorizeLegacyRequest(req,{sourceTable:'user',sourceId:getUser[0].id}); }
          catch (_) { return res.status(503).json({success:false,code:'TEAM_ROLE_ACCESS_UNAVAILABLE'}); }
          if (!roleAccess.allowed) return res.status(403).json({success:false,code:roleAccess.code||'TEAM_ROLE_PERMISSION_DENIED'});
          const optional = require('../modules/platform/optional-features');
          const feature = optional.featureForRequest(req);
          if (feature && !await optional.enabledForUid(getUser[0].uid, feature)) {
            return res.status(403).json({success:false,code:'FEATURE_DISABLED',feature,msg:'This feature is disabled for your account.'});
          }
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

module.exports = validateUser;
