import "dotenv/config";
import axios from "axios";
import { Client, LogLevel } from "@notionhq/client";
import retry from "async-retry";
import './logger.js'
import { logSessionCloser } from './logger.js'

const secret = process.env.API_TESTER_SUPER_EXPERIMENTAL_SECRET;

const dbs = {
	pokedex: process.env.NOTION_DATABASE_ID,
};

let pokeAPIcalls = 0;
let notionQueries = 0;
let notionWrites = 0;

async function buildPokemonArray(start, end) {
	console.log("Querying Notion to get each Pokemon record...");
	const result = await getNotionRecords(notion, dbs.pokedex, start, end);

	console.log("Building array of simplified Pokemon objects...");
	const pokemonMatches = await Promise.all(
		result.map(async (pokemon) => {
			return {
				id: pokemon.id,
				name: pokemon.properties.Name.title[0].text.content,
				number: pokemon.properties.No.number.toString(),
				done: false,
			};
		})
	);

	console.log("Simplified array created.");
	return pokemonMatches;
}

async function getNotionRecords(notion, db, start = 265, end = 269) {
	const rows = [];

	let hasMore;
	let token;

	while (hasMore == undefined || hasMore) {
		notionQueries++;
		console.log(`Sending query ${notionQueries} to Notion...`);
		const response = await retry(
			async (bail) => {
				try {
					return await notion.databases.query({
						database_id: db,
						start_cursor: token,
						filter: {
							and: [
								{
									property: "No",
									number: {
										greater_than_or_equal_to: start,
									},
								},
								{
									property: "No",
									number: {
										less_than_or_equal_to: end,
									},
								},
							],
						},
					});
				} catch (error) {
					if (
						axios.isAxiosError(error) &&
						error.response &&
						error.response.status >= 400 &&
						error.response.status <= 409
					) {
						console.error(
							`Hit un-retriable error when attempting to query Notion. Full error: ${error}`
						);
					}
				}
			},
			{
				retries: 3,
				onRetry: (error) => {
					console.error(`Retrying Notion query due to error: ${error}.`);
				},
			}
		);

		console.log("Query successful. Adding record batch to Pokedex array.");
		rows.push(...response.results);
		console.log(`Fetched ${rows.length} Pokemon so far.`);
		hasMore = response.has_more;
		token = response.next_cursor;
	}

	console.log(`All ${rows.length} Pokemon fetched.`);
	return rows;
}

async function setEvolutionRelationships() {
	console.log("Getting evolution chains from PokeAPI.");

	let nextPage = "https://pokeapi.co/api/v2/evolution-chain/";
	let chainsProcessed = 0;
	let totalChains = 0;

	while (nextPage !== null 
        && chainsProcessed <= totalChains
        && pokemonArray.filter((pokemon) => pokemon.done === false).length > 0
    ) {
		try {
			const chainPage = await getPokeAPIRecord(nextPage);
			console.log(
				`Chain page fetched. Next chain page will be ${chainPage.next}`
			);
			for (let chain of chainPage.results) {
				try {
					const evolutionChain = await getPokeAPIRecord(chain.url);
					console.log(`Chain fetched for ${evolutionChain.chain.species.name}.`);
					await traverseEvolutionTree(evolutionChain.chain, pokemonArray);
					chainsProcessed++;
                    pokeAPIcalls++;
				} catch (error) {
					console.error(error.response ? error.response.status : error.message);
					throw error;
				}
			}
			nextPage = chainPage.next;
			totalChains = chainPage.count;

            if (pokemonArray.filter((pokemon) => pokemon.done === false).length === 0) {
                console.log("All Pokemon have been processed.")
                if (nextPage !== null && nextPage.length > 0) {
                    console.log(`There are additional chain pages, but your Pokedex is fully processed.`)
                }
            }
		} catch (error) {
			console.error(
				`Error encounted in setEvolutionRelationships() while processing chain #${chainsProcessed}.`,
				error
			);
			throw error;
		}
	}

	console.log(`All chains traversed.`);
}

async function getPokeAPIRecord(url) {
	return retry(
		async (bail) => {
			try {
				const response = await axios.get(url);
				return response.data;
			} catch (error) {
				if (
					axios.isAxiosError(error) &&
					error.response &&
					[400, 403, 404].includes(error.response.status)
				) {
					bail(error);
					return;
				}
				console.error(`Error encountered for ${url}:`);
				throw error;
			}
		},
		{
			retries: 3,
			onRetry: (error) => {
				console.error(`Retrying ${url} due to error: ${error}`);
			},
		}
	);
}

async function traverseEvolutionTree(chain, pokemonArray) {
	const evolutions = [];
	console.log(`Travsering chain for ${chain.species.name}.`);
	for (const evolution of chain.evolves_to) {
		const furtherEvolution = await traverseEvolutionTree(
			evolution,
			pokemonArray
		);
		evolutions.push(furtherEvolution);
	}

	// Return the pokemonArray element whose number matches this chain element's species.url number slice
	const number = chain.species.url
		.split("/")
		.filter((element) => element.length > 0)
		.at(-1);

	console.log(`Number for ${chain.species.name} is ${number}.`);

	const pokemon = pokemonArray.find((pokemon) => pokemon.number === number);

	if (pokemon) {
		console.log(
			`Found ${pokemon.name} in the Pokedex array while traversing tree. Updating in Notion.`
		);

		try {
			// Modify the pokemon's record to include its evolutions
			pokemon.evolves_to = evolutions.filter(Boolean);

			// Update the Notion record
			if (pokemon.evolves_to.length > 0) {
				await updateNotionRecord(notion, pokemon);
                notionWrites++
			}

			// Mark the Pokemon done
			pokemon.done = true;

			// Return the pokemon so the function can continue recursively
			return { name: pokemon.name, id: pokemon.id };
		} catch (error) {
			throw error;
		}
	} else {
		console.log(`Didn't find ${chain.species.name} in the Pokedex array.`);
        missingPokemon.push({name: chain.species.name, speciesURL: chain.species.url})
	}
}

async function updateNotionRecord(notion, pokemon) {
	const evolutions = pokemon.evolves_to.map((record) => {
		return {
			id: record.id,
		};
	});

	return retry(
		async (bail) => {
			try {
				return await notion.pages.update({
					page_id: pokemon.id,
					properties: {
						"Evolves To": {
							relation: evolutions,
						},
					},
				});
			} catch (error) {
				if (
					axios.isAxiosError(error) &&
					error.response &&
					error.response.status >= 400 &&
					error.response.status <= 409
				) {
					console.error(
						`Hit un-retriable error when attempting to update Notion page for ${pokemon.name}. Full error: ${error}`
					);
				}
			}
		},
		{
			retries: 3,
			onRetry: (error) => {
				console.error(
					`Retrying Notion update for ${pokemon.name} due to error: ${error}.`
				);
			},
		}
	);
}

// Initializing a client
console.log("Initializing Notion client.");
const notion = new Client({
	auth: secret,
	logLevel: LogLevel.DEBUG,
});

const start = 1;
const end = 905;
console.log("Querying Notion to build the Pokedex array.");
const pokemonArray = await buildPokemonArray(start, end);
console.log("Pokedex array successfully built. Sorting array.");
pokemonArray.sort((a, b) => a.number - b.number);
const missingPokemon = []
console.log("Sorting done. Setting evolution relationships...");
await setEvolutionRelationships();
console.log(`Your Pokedex is missing ${missingPokemon.length} Pokemon found in the traversed chains:`)
console.dir(missingPokemon, {depth: null})
console.log(`Performance Stats:`);
const stats = {
	"Pokemon Processed": end - (start - 1),
	"Notion Queries": notionQueries,
	"Notion Writes": notionWrites,
	"PokeAPI Calls": pokeAPIcalls,
    "Missing Pokemon": missingPokemon.length
};
console.table(stats);
logSessionCloser()