// utils/openaiClient.js
const { OpenAI } = require('openai');
require('dotenv').config();

let client = null;

/**
 * Created on first use. `new OpenAI()` throws when OPENAI_API_KEY is unset,
 * so building it at module load meant a missing env var stopped the server
 * booting rather than degrading the one feature that needed it.
 */
function getOpenAI() {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

module.exports = { getOpenAI };