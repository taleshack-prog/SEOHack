// Qual repositório recebe os artigos de um cliente.
//
// Existe por causa de um erro de precedência que passou despercebido no
// terminal e teria publicado no site errado: o script fazia
//
//   const repo = flag || process.env.GITHUB_REPO || alvo.repo;
//
// e o GITHUB_REPO do .env — que aponta para o site da Hack Tech Farm, porque
// foi o primeiro cliente — venceu o repositório descrito em seeds/targets.json
// para o Posthink. O health check passou (o repositório existe e o token o
// enxerga), o resumo imprimiu o nome errado, e nada indicou problema.
//
// A regra certa: o específico ganha do genérico. A flag da linha de comando é
// a mais específica; o arquivo de destinos descreve um cliente por vez; a
// variável de ambiente é o padrão de quem não tem descrição.

/**
 * @returns {{repo:string|undefined, origem:string, conflito:string|null}}
 *   `conflito` é preenchido quando o ambiente discorda do arquivo — não é
 *   erro, mas precisa aparecer na tela antes de alguém publicar no lugar errado.
 */
export function escolherRepo({ flag, alvo, env } = {}) {
  const limpo = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const [f, a, e] = [limpo(flag), limpo(alvo), limpo(env)];

  if (f) {
    return { repo: f, origem: '--repo',
             conflito: a && a !== f ? `--repo (${f}) sobrepõe seeds/targets.json (${a})` : null };
  }
  if (a) {
    return { repo: a, origem: 'seeds/targets.json',
             conflito: e && e !== a
               ? `GITHUB_REPO do .env vale ${e}, mas este cliente publica em ${a} — o arquivo manda`
               : null };
  }
  return { repo: e, origem: e ? '.env (GITHUB_REPO)' : 'nenhuma', conflito: null };
}
