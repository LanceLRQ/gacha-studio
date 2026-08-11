// gs:check 系列脚本统一的输出格式：
//   - 每道门一行状态（✅/❌/⏭️）
//   - 失败时打印可定位的命中详情（文件:行号:列号 + 源码行文本）
//   - 结尾一行汇总（通过/失败/跳过各多少项）
//
// 不引入任何第三方彩色库，纯文本 + emoji 图标，保证在任意终端下都能正常显示。

const ICONS = {
  pass: '✅',
  fail: '❌',
  skip: '⏭️ ',
};

/**
 * 打印单道门的检查结果。
 *
 * @param {{
 *   id: string,
 *   title: string,
 *   status: 'pass' | 'fail' | 'skip',
 *   findings: Array<{ file: string, line: number, column: number, reason: string, snippet?: string }>,
 *   notes?: string[],
 * }} result
 */
export function renderResult(result) {
  const icon = ICONS[result.status] ?? '❓';
  console.log(`${icon} ${result.title}`);

  for (const finding of result.findings) {
    const location =
      finding.line > 0 ? `${finding.file}:${finding.line}:${finding.column}` : finding.file;
    console.log(`   ${location}  ${finding.reason}`);
    if (finding.snippet) {
      for (const snippetLine of String(finding.snippet).split('\n')) {
        console.log(`     ${snippetLine}`);
      }
    }
  }

  for (const note of result.notes ?? []) {
    console.log(`   · ${note}`);
  }
}

/**
 * 打印一批检查结果的汇总行。
 *
 * @param {Array<{ status: 'pass' | 'fail' | 'skip' }>} results
 * @returns {number} 失败的门数量，供调用方决定退出码
 */
export function renderSummary(results) {
  const pass = results.filter((r) => r.status === 'pass').length;
  const fail = results.filter((r) => r.status === 'fail').length;
  const skip = results.filter((r) => r.status === 'skip').length;

  console.log('');
  console.log(`汇总：通过 ${pass} 项，失败 ${fail} 项，跳过 ${skip} 项`);

  return fail;
}
