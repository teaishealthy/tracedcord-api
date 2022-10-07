
interface Traceback {
  filename: string;
  lineno: number;
  content: string;
}

interface Result {
  expected: string;
  actual: string;
  same: boolean;
}

function normalizePath(path: string): string {
  let relPath = "";
  let delim = "\\";
  if (path.includes("/")) {
      delim = "/";
  }

  for (const pathElement of path.split(delim).reverse()) {
      relPath = "/" + pathElement + relPath;
      if (pathElement == "nextcord") {
          break;
      }
  }
  return relPath.slice(1);
}



function parse(traceback: string): Traceback[] {
  let tracebacks: Traceback[] = [];
  let lines: string[] = traceback.split('\n');
  let idx: number = 0;
  while (idx < lines.length) {
      let line: string = lines[idx];
      if (line.trim().startsWith("File")) {
          let filename: string = lines[idx].split('"')[1];
          let lineno: number = parseInt(lines[idx].split(',')[1].trim().split(" ")[1]);
          idx += 1;
          let content: string = lines[idx].trim();
          idx += 1;
          

          tracebacks.push({filename: normalizePath(filename), lineno, content});
      }
      idx += 1;
  }
  return tracebacks;
}

async function getSimilarity(tracebacks: Traceback[], version: string = "master") {
  const matches: Result[] = [];
  for (const traceback of tracebacks) {
      const res = await fetch(`https://raw.githubusercontent.com/nextcord/nextcord/${version}/${traceback.filename}`);
      var got = (await res.text()).split('\n')[traceback.lineno - 1];
      if (got === undefined) {
        continue;
      }
      const actual = traceback.content.split('\t').at(-1);
      if (actual === undefined) throw new Error("actual is undefined");
      const expected = got.trim();
      matches.push({expected, actual, same: expected === actual});
  }
  return matches;
}

function assumeLatestVersion(branches: string[]): string {
  // find the latest version from v.x.x.x named branches
  const versions = branches.map((branch) => branch.slice(1));
  const latest = versions.sort((a, b) => {
      const aParts = a.split('.');
      const bParts = b.split('.');
      for (let i = 0; i < aParts.length; i++) {
          if (aParts[i] !== bParts[i]) {
              return parseInt(aParts[i]) - parseInt(bParts[i]);
          }
      }
      return 0;
  }
  ).at(-1);
  if (latest === undefined) throw new Error("latest is undefined");
  return latest;
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  if (new URL(request.url).pathname != "" && request.method != "POST") {
    return new Response('Not found', { status: 404 })
  }
  const traceback = await request.text();
  const response = await fetch("https://api.github.com/repos/nextcord/nextcord/branches", {
    headers: {
      "User-Agent": "tracedcord-api server",
    }
  })
  const branches = await response.json();
  

  // @ts-ignore
  const branchNames: string[] = branches.map(branch => branch.name).filter(branch => branch.startsWith("v"));
  console.log(branchNames)
  const tracebacks = parse(traceback)
  const results = await Promise.all(branchNames.map(async (branch: string) => {
    return [branch, await getSimilarity(tracebacks, branch)]
    
  }))

  // FIXME: remove the @ts-ignore soon

  const sorted = results.sort((a, b) => {
    // @ts-ignore
    const aSame = a[1].filter(result => result.same).length;
    // @ts-ignore
    const bSame = b[1].filter(result => result.same).length;
    return bSame - aSame;
  })
  const latest = assumeLatestVersion(branchNames);
  const flattened = Object.assign({}, ...sorted.map((e) => {
  // @ts-ignore
  return {[e[0]]: e[1]}
}));

  return new Response(JSON.stringify({latest: `v${latest}`, likely: sorted[0][0], results: flattened, }), {
    headers: {
      "content-type": "application/json;charset=UTF-8",
    }})
}

const worker: ExportedHandler<Env> = { fetch: handleRequest };
export default worker;
