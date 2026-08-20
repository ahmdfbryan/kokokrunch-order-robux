const config = require('./config');

// Daftar nominal custom sesuai permintaan.
const ROBUX_AMOUNTS = [
  100, 200, 300, 400, 500, 600, 700, 800, 900, 1000,
  1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000,
];

function priceForAmount(robuxAmount) {
  return robuxAmount * config.rupiahPerRobux;
}

module.exports = { ROBUX_AMOUNTS, priceForAmount };
