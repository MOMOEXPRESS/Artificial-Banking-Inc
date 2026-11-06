/** Exact USDC display/input conversion; no floating-point money arithmetic. */
export function usdcInputToMicro(input:string):string{
  const value=input.trim();if(!/^\d{1,18}(?:\.\d{1,6})?$/.test(value))throw Error("Enter a non-negative USDC price with at most six decimal places.");
  const [whole,fraction=""]=value.split(".");return (BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,"0"))).toString();
}
export function microToUsdcInput(input:string):string{const n=BigInt(input);return `${n/1000000n}.${(n%1000000n).toString().padStart(6,"0").replace(/0+$/,"")||"00"}`;}
