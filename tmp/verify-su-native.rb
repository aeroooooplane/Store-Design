# encoding: UTF-8
require 'json'
module StoreNativeVerify
  ROOT=File.expand_path('../资源库/90_处理过程与审核/模型拆分/split-20260925-v2',__dir__)
  def self.run
    model=Sketchup.active_model
    raise 'Do not run native probe in source model' if File.basename(model.path)=='影石通用模型.skp'
    m=JSON.parse(File.read(File.join(ROOT,'manifest.json')))
    s=JSON.parse(File.read(File.join(ROOT,'source-mesh-bounds.json')))['results'].to_h{|r|[r['asset_id'],r]}
    rows=[]
    File.write(File.join(ROOT,'native-verification.json'),JSON.pretty_generate({status:'running',checked:0,results:[]}))
    m['assets'].each do |a|
      folder=a['folder']
      folder=File.join(ROOT,folder) unless folder.match?(/\A[A-Za-z]:/)
      expected=s[a['asset_id']]
      begin
        definition=model.definitions.load(File.join(folder,'prop-instance.skp'))
        roots=definition.entities.select{|e|e.is_a?(Sketchup::ComponentInstance)||e.is_a?(Sketchup::Group)}
        raise 'Expected one preserved root instance' unless roots.length==1
        entity=roots.first
        effective=entity;transform=entity.transformation
        if entity.get_attribute('StoreAssetExport','precision_wrapper',false)
          effective=entity.definition.entities.find{|e|e.is_a?(Sketchup::ComponentInstance)||e.is_a?(Sketchup::Group)}
          transform=transform*effective.transformation
        end
        delta=transform.to_a.zip(expected['instance_transform_without_translation']).map{|x,y|(x-y).abs}.max
        material=effective.material ? effective.material.display_name : nil
        properties=nil
        if effective.material
          mat=effective.material;tex=mat.texture
          properties={'color'=>mat.color.to_a,'alpha'=>mat.alpha.round(8),'texture'=>tex ? [tex.image_width,tex.image_height,tex.width.to_f.round(8),tex.height.to_f.round(8)] : nil}
        end
        raise "Root transform changed: #{delta}" if delta>0.000001
        raise "Root material properties changed: #{material}" unless properties==expected['root_material_properties']
        b=definition.bounds
        dimensions=[b.width,b.height,b.depth].map{|v|v.to_f*0.0254}
        source_bounds=JSON.parse(File.read(File.join(folder,'metadata.json')))['world_bounds_m']
        dimension_error=dimensions.zip(source_bounds).map{|x,y|(x-y).abs*1000}.max
        @cache={};tight=Geom::BoundingBox.new;walk(definition,Geom::Transformation.new,tight)
        tight_dims=[tight.width,tight.height,tight.depth].map{|v|v.to_f*0.0254}
        tight_error=tight_dims.zip(expected['tight_visible_face_bounds_m']).map{|x,y|(x-y).abs*1000}.max
        raise "Native face geometry changed: #{tight_error} mm" if tight_error>0.01
        definition.save_thumbnail(File.join(ROOT,a['asset_id'],'preview-instance.png'))
        row={asset_id:a['asset_id'],status:'passed',root_transform_error:delta,root_material:material,root_material_properties:properties,dimensions_m:dimensions,max_bounds_error_mm:dimension_error,tight_bounds_m:tight_dims,max_face_bounds_error_mm:tight_error,root_children:entity.definition.entities.length,precision_wrapper:entity.get_attribute('StoreAssetExport','precision_wrapper',false)}
      rescue => e
        row={asset_id:a['asset_id'],status:'failed',error:"#{e.class}: #{e.message}"}
      end
      rows << row
      @cache.clear if @cache
      model.definitions.purge_unused
      model.materials.purge_unused
      GC.start
      File.write(File.join(ROOT,'native-verification.json'),JSON.pretty_generate({status:'running',checked:rows.length,results:rows}))
    end
    File.write(File.join(ROOT,'native-verification.json'),JSON.pretty_generate({status:'complete',checked:rows.length,passed:rows.count{|r|r[:status]=='passed'},results:rows,note:'Each instance SKP loaded by SketchUp in a separate probe model; root transform, material and bounds compared with source records. No source model changes.'}))
  rescue => e
    File.write(File.join(ROOT,'native-verification-error.txt'),"#{e.class}: #{e.message}\n#{e.backtrace.join("\n")}")
  end
  def self.walk(definition,t,bounds)
    data=@cache[definition.guid]
    unless data
      vertices={};children=[];images=[]
      definition.entities.each do |e|
        next if e.hidden? || !e.layer.visible?
        if e.is_a?(Sketchup::Face)
          e.vertices.each{|v|vertices[v.entityID]=v.position}
        elsif e.is_a?(Sketchup::Group)||e.is_a?(Sketchup::ComponentInstance)
          children<<e
        elsif e.is_a?(Sketchup::Image)
          x=e.transformation.xaxis;x.length=e.width;y=e.transformation.yaxis;y.length=e.height;o=e.origin
          images.concat([o,o+x,o+y,o+x+y])
        end
      end
      data={vertices:vertices.values+images,children:children};@cache[definition.guid]=data
    end
    data[:vertices].each{|p|bounds.add(p.transform(t))}
    data[:children].each{|e|walk(e.definition,t*e.transformation,bounds)}
  end
end
StoreNativeVerify.run
