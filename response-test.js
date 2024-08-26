import axios from "axios";
import retry from "async-retry";

async function getChainRecord() {
    return retry(
        async (bail) => {
            try {
                const response = await axios.get(`https://pokeapi.co/api/v2/evolution-chain/`)
                return response.data
            } catch (error) {
                if (axios.isAxiosError(error) && error.response && [400, 403, 404].includes(error.response.status)) {
                    bail(error)
                    return
                }
                console.error(`Error encountered:`)
                throw error
            }
        },
        {
            retries: 3,
            onRetry: (error) => {
                console.error(`Retrying due to error: ${error}`)
            }
        }
    )
}

const result = await getChainRecord()
console.dir(result.next, {depth: null})

