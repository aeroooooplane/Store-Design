# encoding: UTF-8
# Regression: a nested callback must not clear the outer export's busy flag.
source = File.read(File.join(__dir__, 'run-su-split-20260925.rb'))
source = source.lines.reject { |s| s.start_with?('load ') || s.strip == 'StoreSplit20260925.start' }.join
sandbox = Module.new
sandbox.module_eval(source, File.join(__dir__, 'run-su-split-20260925.rb'))
runner = sandbox.const_get(:StoreSplit20260925)
runner.instance_variable_set(:@busy, true)
runner.step
result = runner.instance_variable_get(:@busy) == true
File.write(File.join(__dir__, 'su-reentry-test-result.txt'), result ? 'PASS: nested entry preserved active export lock' : 'FAIL: nested entry cleared active export lock')
puts File.read(File.join(__dir__, 'su-reentry-test-result.txt'))
