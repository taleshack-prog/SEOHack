// ADAPTER: GitHub — o caminho de instalação zero.
//
// Substitui completamente a função F8. A F8 existia porque o PRD v4 assumiu que
// o site precisava RECEBER um POST. Não precisa: a fronteira real é a API do
// GitHub, que é chamável de qualquer lugar. O cliente autoriza um GitHub App
// uma vez e nunca instala uma linha de código.
//
// Faz blob -> tree -> commit -> updateRef: UM commit atômico com N arquivos,
// independentemente do tamanho do lote (bloqueador A4 da auditoria — a Contents
// API fazia um commit por arquivo, gerando N rebuilds).
const API = 'https://api.github.com';

async function gh(token, path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`GitHub ${res.status} em ${path}: ${body.slice(0, 300)}`);
    err.statusCode = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

export const id = 'github';

/** Confere que o token enxerga o repo e a branch antes de tentar publicar. */
export async function healthCheck({ token, repo, branch = 'main' }) {
  await gh(token, `/repos/${repo}/git/ref/heads/${branch}`);
  return { ok: true, repo, branch };
}

/**
 * @param {Array<{path:string, content:string}>} files
 * @returns {Promise<{commitSha:string, files:string[]}>}
 */
export async function publish({ token, repo, branch = 'main', files, message }, { maxAttempts = 3 } = {}) {
  if (!files.length) return { commitSha: null, files: [] };

  // Blobs podem ser criados uma vez só — não dependem do HEAD.
  const blobs = [];
  for (const f of files) {
    const blob = await gh(token, `/repos/${repo}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({
        content: Buffer.from(f.content, 'utf8').toString('base64'),
        encoding: 'base64',
      }),
    });
    blobs.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
  }

  // Tree, commit e ref dependem do HEAD. Se alguém commitou no meio do caminho,
  // o updateRef falha com 422 non-fast-forward: refazemos a partir do novo HEAD.
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const ref = await gh(token, `/repos/${repo}/git/ref/heads/${branch}`);
      const headSha = ref.object.sha;
      const headCommit = await gh(token, `/repos/${repo}/git/commits/${headSha}`);

      const tree = await gh(token, `/repos/${repo}/git/trees`, {
        method: 'POST',
        body: JSON.stringify({ base_tree: headCommit.tree.sha, tree: blobs }),
      });

      const commit = await gh(token, `/repos/${repo}/git/commits`, {
        method: 'POST',
        body: JSON.stringify({ message, tree: tree.sha, parents: [headSha] }),
      });

      await gh(token, `/repos/${repo}/git/refs/heads/${branch}`, {
        method: 'PATCH',
        body: JSON.stringify({ sha: commit.sha, force: false }),
      });

      return { commitSha: commit.sha, files: files.map((f) => f.path) };
    } catch (err) {
      lastErr = err;
      const conflict = err.statusCode === 422 || err.statusCode === 409;
      if (!conflict || attempt === maxAttempts) throw err;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  throw lastErr;
}

/** Lê um arquivo existente — usado para extrair o shell de template do cliente. */
export async function readFile({ token, repo, branch = 'main', path }) {
  try {
    const data = await gh(token, `/repos/${repo}/contents/${path}?ref=${branch}`);
    return Buffer.from(data.content, 'base64').toString('utf8');
  } catch (err) {
    if (err.statusCode === 404) return null;
    throw err;
  }
}
