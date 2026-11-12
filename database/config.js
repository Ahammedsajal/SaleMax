const mysql = require("mysql2");

function poolOption(name, fallback, min, max) {
  const raw = process.env[name];
  const value = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`Invalid database pool setting: ${name}`);
  }
  return value;
}

const connectionLimit = poolOption("DB_POOL_LIMIT", 50, 1, 120);
const maxIdle = poolOption(
  "DB_POOL_MAX_IDLE",
  Math.min(1, connectionLimit - 1),
  0,
  connectionLimit - 1,
);
const idleTimeout = poolOption("DB_POOL_IDLE_TIMEOUT_MS", 60000, 1000, 3600000);

const con = mysql.createPool({
  connectionLimit,
  maxIdle,
  idleTimeout,
  host: process.env.DBHOST || "localhost",
  port: process.env.DBPORT || 3306,
  ...(process.env.LOCAL_ONLY_MODE === "true" && process.env.SALEMAX_TEST_DB_SOCKET ? { socketPath: process.env.SALEMAX_TEST_DB_SOCKET } : {}),
  user: process.env.DBUSER,
  password: process.env.DBPASS,
  database: process.env.DBNAME,
  charset: "utf8mb4",
  waitForConnections: true,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
});

// Handle connection errors
con.on("connection", function (connection) {
  // console.log("Database connection established as id " + connection.threadId);
});

con.on("error", function (err) {
  console.error("Database error:", err);
  if (err.code === "PROTOCOL_CONNECTION_LOST") {
    console.log("Database connection lost, reconnecting...");
  }
});

con.getConnection((err, connection) => {
  if (err) {
    console.log({
      err: err,
      msg: "Database connected error",
    });
    return;
  } else {
    console.log("Database has been connected");
    connection.release();
  }
});

module.exports = con;
