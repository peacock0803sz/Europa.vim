function! europa#open(path) abort
  call denops#notify('europa', 'open', [a:path])
endfunction

function! europa#save() abort
  call denops#notify('europa', 'save', [bufnr('%')])
endfunction

function! europa#preview_output(cell_idx, output_idx) abort
  call denops#notify('europa', 'previewOutput', [bufnr('%'), a:cell_idx, a:output_idx])
endfunction
