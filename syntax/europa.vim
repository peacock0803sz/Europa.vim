if exists('b:current_syntax')
  finish
endif

let s:chars = get(g:, 'europa_cell_border_chars', ['╭', '─', '╮', '╰', '╯'])
if type(s:chars) ==# v:t_list && len(s:chars) >=# 5
  let s:tl = s:chars[0]
  let s:bl = s:chars[3]
else
  let s:tl = '╭'
  let s:bl = '╰'
endif

" \V makes the prefix very-literal; \m restores normal magic for the rest.
" escape() with '/\' guards both the pattern delimiter and backslash.
" Schema enforces no '/' or newlines in chars, so this is double-defended.
execute 'syntax match EuropaCellHeader /^\V' .. escape(s:tl, '/\') .. '\m.*$/'
execute 'syntax match EuropaCellFooter /^\V' .. escape(s:bl, '/\') .. '\m.*$/'

highlight default link EuropaCellHeader Comment
highlight default link EuropaCellFooter Comment

let b:current_syntax = 'europa'
