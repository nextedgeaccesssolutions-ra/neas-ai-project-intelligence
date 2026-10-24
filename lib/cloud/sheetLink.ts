import 'server-only';
// The master spreadsheet's address is kept on the server and given to Super Admins only,
// so it is not shipped in the browser bundle to every signed-in user.
const FALLBACK_ID = '19e14iR4X8ZLDARO2auYe0Cm4jPoZGUlGvC9O2f9EIAQ';
export const sheetUrl = () => `https://docs.google.com/spreadsheets/d/${process.env.SHEETS_SPREADSHEET_ID || FALLBACK_ID}/edit`;
