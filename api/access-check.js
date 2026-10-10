import {accessReport} from '../lib/access.mjs';
import {bodyOf} from '../lib/handler.mjs';

// Answers "why was my class code turned away?" without ever echoing the code or the stored value -
// only their lengths and a few flags, plus which environment served the request. Deliberately
// unguarded and always 200, so a rejection here can never be mistaken for a wrong code.
export default function handler(req, res) {
  const body = bodyOf(req);
  const code = body.accessCode == null ? req.headers['x-access-code'] : body.accessCode;
  res.status(200).json(accessReport(code));
}
