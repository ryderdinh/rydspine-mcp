import { fetchCoin } from "./coin.js";

export default async function setup() {
	await fetchCoin();
}
