import fs from 'fs'
import util from 'util'
import stripAnsi from 'strip-ansi'

const logFile = fs.createWriteStream('output.log', { flags: 'a' })
const logStdout = process.stdout

function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are zero-based, add leading zero
    const day = String(date.getDate()).padStart(2, '0'); // Add leading zero
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function logSessionHeader(...args) {
    const timestamp = formatDate(new Date());
    const separator = '==================================================';
    const sessionHeader = `\n${separator}\nNew Session: ${timestamp}\n${separator}\n`;

    logFile.write(sessionHeader);
    logStdout.write(sessionHeader);
}

export function logSessionCloser() {
    const timestamp = formatDate(new Date());
    const separator = '==================================================';
    const sessionCloser = `\n${separator}\nSession Closed: ${timestamp}\n${separator}\n`;

    logFile.write(sessionCloser);
    logStdout.write(sessionCloser);
}

logSessionHeader();

console.log = function (...args) {
    const message = util.format(...args) + '\n';
    logFile.write(stripAnsi(message));
    logStdout.write(message);
}

console.error = function (...args) {
    const message = util.format(...args) + '\n';
    logFile.write(stripAnsi(message));
    logStdout.write(message);
};