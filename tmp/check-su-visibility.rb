# encoding: UTF-8
require 'json'
module StoreVisibilityCheck
  ROOT=File.expand_path('../资源库/90_处理过程与审核/模型拆分/split-20260925-v2',__dir__)
  def self.run
    model=Sketchup.active_model
    raise 'Wrong source' unless File.basename(model.path)=='影石通用模型.skp'
    manifest=JSON.parse(File.read(File.join(ROOT,'manifest.json')))
    visible=JSON.parse(File.read(File.join(ROOT,'source-mesh-bounds.json')))['results'].to_h{|r|[r['asset_id'],r]}
    dae=JSON.parse(File.read(File.join(ROOT,'validation-summary.json')))['results'].to_h{|r|[r['asset_id'],r]}
    rows=[]
    manifest['assets'].each do |a|
      d=dae[a['asset_id']]['dae_bounds_m'];v=visible[a['asset_id']]['tight_visible_face_bounds_m']
      next unless d.zip(v).any?{|x,y|(x-y).abs>0.001}
      e=model.find_entity_by_persistent_id(a['pid']);modes={}
      %w[all hidden_flag_only layer_only].each do |mode|
        @cache={};b=Geom::BoundingBox.new;walk(e.definition,e.transformation,b,mode)
        dims=[b.width,b.height,b.depth].map{|x|x.to_f*0.0254}
        modes[mode]={bounds_m:dims,dae_error_mm:dims.zip(d).map{|x,y|(x-y).abs*1000}.max}
      end
      rows << {asset_id:a['asset_id'],modes:modes}
      File.write(File.join(ROOT,'visibility-diagnostics.json'),JSON.pretty_generate({status:'running',checked:rows.length,results:rows}))
    end
    File.write(File.join(ROOT,'visibility-diagnostics.json'),JSON.pretty_generate({status:'complete',checked:rows.length,results:rows}))
    @cache.clear;GC.start
    puts "Visibility checks complete: #{rows.length}"
  rescue=>e
    File.write(File.join(ROOT,'visibility-check-error.txt'),"#{e.class}: #{e.message}\n#{e.backtrace.join("\n")}")
    raise
  end
  def self.walk(definition,t,bounds,mode)
    data=@cache[definition.guid]
    unless data
      points={};children=[];images=[]
      definition.entities.each do |e|
        next if mode=='hidden_flag_only' && e.hidden?
        next if mode=='layer_only' && !e.layer.visible?
        if e.is_a?(Sketchup::Face)
          e.vertices.each{|v|points[v.entityID]=v.position}
        elsif e.is_a?(Sketchup::Group)||e.is_a?(Sketchup::ComponentInstance)
          children << e
        elsif e.is_a?(Sketchup::Image)
          x=e.transformation.xaxis;x.length=e.width;y=e.transformation.yaxis;y.length=e.height;o=e.origin
          images.concat([o,o+x,o+y,o+x+y])
        end
      end
      data={points:points.values+images,children:children};@cache[definition.guid]=data
    end
    data[:points].each{|p|bounds.add(p.transform(t))}
    data[:children].each{|e|walk(e.definition,t*e.transformation,bounds,mode)}
  end
end
StoreVisibilityCheck.run
