// 词法级“剥离注释”状态机。
//
// 用途：HC-1 需要在真代码位置扫描 eval(/require(/动态 import( 等关键词，
// 但不能被注释里的示例文字污染（例如 plugins/index.ts 的 JSDoc 里就写着
// `() => import("./genshin/manifest")` 作为使用范例）。同时又不能把字符串
// /模板字符串的内容也当成注释剥掉——`require("child_process")` 这种写在
// 字符串参数里的关键词恰恰是 HC-1 要抓的对象。
//
// 因此这里只剥离真正的注释区间（替换为等长空格，换行符原样保留以维持行号），
// 字符串与模板字符串的内容一律原样保留。
//
// 实现方式：一个逐字符扫描的状态机。除了行注释/块注释/单引号/双引号字符串
// 这些平坦状态外，还需要一个“上下文栈”来正确处理模板字符串的插值嵌套——
// 模板字符串内部的 `${ ... }` 是真代码，可能包含对象字面量（花括号）甚至
// 嵌套的模板字符串，必须用栈 + 花括号计数才能正确找到插值的结束 `}`，
// 不会被插值内部的 `{`/`}` 提前打断，也不会把嵌套模板的边界弄混。

/**
 * 剥离源码中的注释，字符串/模板字符串内容原样保留。
 * 返回值与输入等长（含换行符位置一致），可直接用字符偏移量换算行列号。
 *
 * @param {string} source 原始源码
 * @returns {string} 注释区间被替换为空格后的文本
 */
export function stripComments(source) {
  const out = [];
  const len = source.length;
  let i = 0;

  // 上下文栈：栈顶决定当前处于“代码”还是“模板字符串内容”。
  //   { type: 'root' }               —— 顶层代码（哨兵，不会被弹出）
  //   { type: 'template' }           —— 处于某个模板字符串的字面量部分（非插值），原样透传
  //   { type: 'interp', depth: 0 }   —— 处于某层模板插值 ${...} 内部，depth 记录插值内部
  //                                      嵌套花括号（对象字面量等）的深度，用于正确匹配插值的结束 `}`
  const stack = [{ type: 'root' }];

  // 代码上下文（root / interp）内的子状态，用于识别注释与普通字符串。
  // 模板字符串内容部分（template）不进入这些子状态——按 brief 要求，
  // 模板内容里的 `//`、`/*` 不触发注释识别。
  let subState = 'NONE'; // NONE | LINE_COMMENT | BLOCK_COMMENT | STRING_SINGLE | STRING_DOUBLE

  while (i < len) {
    const top = stack[stack.length - 1];
    const ch = source[i];

    if (top.type === 'template') {
      // 模板字符串的字面量部分：只关心转义、插值开始 ${、模板结束 `
      if (ch === '\\') {
        out.push(ch, source[i + 1] ?? '');
        i += 2;
        continue;
      }
      if (ch === '`') {
        stack.pop();
        out.push(ch);
        i += 1;
        continue;
      }
      if (ch === '$' && source[i + 1] === '{') {
        stack.push({ type: 'interp', depth: 0 });
        out.push('$', '{');
        i += 2;
        continue;
      }
      out.push(ch);
      i += 1;
      continue;
    }

    // 走到这里说明 top.type 是 'root' 或 'interp'，即代码上下文。
    if (subState === 'LINE_COMMENT') {
      if (ch === '\n') {
        subState = 'NONE';
        out.push('\n');
      } else {
        out.push(' ');
      }
      i += 1;
      continue;
    }

    if (subState === 'BLOCK_COMMENT') {
      if (ch === '*' && source[i + 1] === '/') {
        subState = 'NONE';
        out.push(' ', ' ');
        i += 2;
        continue;
      }
      out.push(ch === '\n' ? '\n' : ' ');
      i += 1;
      continue;
    }

    if (subState === 'STRING_SINGLE' || subState === 'STRING_DOUBLE') {
      const quote = subState === 'STRING_SINGLE' ? "'" : '"';
      if (ch === '\\') {
        out.push(ch, source[i + 1] ?? '');
        i += 2;
        continue;
      }
      if (ch === quote) {
        subState = 'NONE';
        out.push(ch);
        i += 1;
        continue;
      }
      out.push(ch);
      i += 1;
      continue;
    }

    // subState === 'NONE'，真正处于可识别注释/字符串起点的代码位置
    const next = source[i + 1];

    if (ch === '/' && next === '/') {
      subState = 'LINE_COMMENT';
      out.push(' ', ' ');
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      subState = 'BLOCK_COMMENT';
      out.push(' ', ' ');
      i += 2;
      continue;
    }
    if (ch === "'") {
      subState = 'STRING_SINGLE';
      out.push(ch);
      i += 1;
      continue;
    }
    if (ch === '"') {
      subState = 'STRING_DOUBLE';
      out.push(ch);
      i += 1;
      continue;
    }
    if (ch === '`') {
      stack.push({ type: 'template' });
      out.push(ch);
      i += 1;
      continue;
    }

    if (top.type === 'interp') {
      if (ch === '{') {
        top.depth += 1;
        out.push(ch);
        i += 1;
        continue;
      }
      if (ch === '}') {
        if (top.depth === 0) {
          // 插值结束，回到外层模板字面量部分
          stack.pop();
          out.push(ch);
          i += 1;
          continue;
        }
        top.depth -= 1;
        out.push(ch);
        i += 1;
        continue;
      }
    }

    out.push(ch);
    i += 1;
  }

  return out.join('');
}
