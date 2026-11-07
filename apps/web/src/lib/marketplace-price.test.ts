import assert from "node:assert/strict";
import { test } from "node:test";
import { usdcInputToMicro,microToUsdcInput } from "./marketplace-price";
test("USDC prices preserve all six decimals without floating-point rounding",()=>{assert.equal(usdcInputToMicro("0.000001"),"1");assert.equal(usdcInputToMicro("12.345678"),"12345678");assert.equal(usdcInputToMicro(microToUsdcInput("9007199254740993")),"9007199254740993");assert.throws(()=>usdcInputToMicro("1.1234567"));assert.throws(()=>usdcInputToMicro("-1"));});
