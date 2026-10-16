// Run explicitly on the server after deployment. No registrations, customer records, emails or charges.
import {probeStripeCheckout} from './stripe-payments.js';
const result=await probeStripeCheckout();
console.log(JSON.stringify(result,null,2));
if(!result.ready)process.exitCode=2;
