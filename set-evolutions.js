/**
 * To Do
 * - Add rate-limiting and retry logic (blocking)
 * - Swap to Evolution Chain iteration, instead of iterating over pokemonArray
 */

import "dotenv/config";
import axios from "axios";
import { Client, LogLevel } from "@notionhq/client";

const secret = process.env.API_TESTER_SUPER_EXPERIMENTAL_SECRET;

const dbs = {
	pokedex: process.env.NOTION_DATABASE_ID,
};

let pokeAPIcalls = 0;
let speciesCalls = 0
let evolutionCalls = 0
let notionQueries = 0;
let notionWrites = 0;

async function getNotionRecords(notion, db, start = 265, end = 269) {
	const rows = [];

	let hasMore;
	let token;

	while (hasMore == undefined || hasMore) {
		notionQueries++;

		const response = await notion.databases.query({
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

		rows.push(...response.results);
		hasMore = response.has_more;
		token = response.next_cursor;
	}

	return rows;
}

async function buildPokemonArray(start, end) {
	const result = await getNotionRecords(notion, dbs.pokedex, start, end);

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

	return pokemonMatches;
}

async function setEvolutionRelationships(pokemonArray) {
	for (let pokemon of pokemonArray) {
		if (pokemon.done === false) {
			console.log(`Processing ${pokemon.name}...`);
			const speciesRecord = await getSpeciesRecord(pokemon.number);

			const evolutionChain = await getEvolutionChain(
				speciesRecord.evolution_chain
			);

			await traverseEvolutionTree(evolutionChain, pokemonArray);
		}
	}
}

async function traverseEvolutionTree(chain, pokemonArray) {
	const evolutions = [];
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

	console.log(`Number is ${number}.`);

	const pokemon = pokemonArray.find((pokemon) => pokemon.number === number);

	if (pokemon) {
		console.log(`Found ${pokemon.name} while traversing tree.`);

		// Modify the pokemon's record to include its evolutions
		pokemon.evolves_to = evolutions.filter( Boolean );

		// Update the Notion record
        if (pokemon.evolves_to.length > 0) {
            await updateNotionRecord(notion, pokemon)
        }
        
        // Mark the Pokemon done
		pokemon.done = true;

		// Return the pokemon so the function can continue recursively
		return { name: pokemon.name, id: pokemon.id }
	}
}

async function updateNotionRecord(notion, pokemon) {
    const evolutions = pokemon.evolves_to.map((record) => {
        return {
            id: record.id,
        }
    })
    
    return await notion.pages.update({
        page_id: pokemon.id,
        properties: {
            "Evolves To": {
                relation: evolutions
            }
        }
    })
}

async function getEvolutionChain(chainURL) {
	pokeAPIcalls++;
    evolutionCalls++;
	const response = await axios.get(chainURL);
	return response.data.chain;
}

async function getSpeciesRecord(pokemonNumber) {
	pokeAPIcalls++;
    speciesCalls++;
	const response = await axios.get(
		`https://pokeapi.co/api/v2/pokemon-species/${pokemonNumber}`
	);
	return {
		name: response.data.name,
		name_en: response.data.names.find(({ language: { name } }) => name === "en")
			.name,
		evolution_chain: response.data.evolution_chain.url,
	};
}

// Initializing a client
const notion = new Client({
	auth: secret,
	logLevel: LogLevel.DEBUG,
});

const start = 1;
const end = 905;
const pokemonArray = await buildPokemonArray(start, end);
pokemonArray.sort((a, b) => a.number - b.number);
await setEvolutionRelationships(pokemonArray);
console.dir(pokemonArray, { depth: null });
console.log(
	`Performance Stats:`
);
const stats = {
    "Pokemon Processed": end - (start - 1),
    "Notion Queries": notionQueries,
    "Notion Writes": notionWrites,
    "PokeAPI Calls (Total)": pokeAPIcalls,
    "Species Calls": speciesCalls,
    "Evolution Chain Calls": evolutionCalls
}
console.table(stats)
