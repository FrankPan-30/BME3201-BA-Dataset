% Read-only native MATLAB export of string names and BA recordings.
root = fileparts(fileparts(mfilename('fullpath')));
dataRoot = getenv('BA_DATA_ROOT');
if isempty(dataRoot), dataRoot = 'F:/dataset/dataset'; end
out = fullfile(root,'data_derived');
files = dir(fullfile(dataRoot,'*.mat'));
inventory = struct([]); n = 0;
for i = 1:numel(files)
    x = load(fullfile(files(i).folder,files(i).name),'s'); s = x.s;
    fields = fieldnames(s); meta = rmfield(s,fields(startsWith(fields,'Data')));
    for j = 1:numel(fields)
        fld = fields{j}; if ~startsWith(fld,'Data'), continue; end
        tasks = s.(fld);
        for k = 1:numel(tasks)
            t = tasks(k); n = n+1;
            inventory(n).subject = erase(files(i).name,'.mat');
            inventory(n).limb = fld;
            inventory(n).task = char(t.TaskCode);
            inventory(n).repetitions = numel(t.Events.Start);
            inventory(n).marker_rows = size(t.Marker,1);
            inventory(n).angle_rows = size(t.Angles,1);
            inventory(n).emg_rows = size(t.EMG,1);
            if strcmpi(string(t.TaskCode),'BA')
                t.TaskCode = char(t.TaskCode);
                t.MarkerVarName = cellstr(t.MarkerVarName);
                t.EmgVarName = cellstr(t.EmgVarName);
                t.AngleVarName = cellstr(t.AngleVarName);
                save(fullfile(out,[erase(files(i).name,'.mat') '_' fld '_BA.mat']),'t','meta','-v7');
            end
        end
    end
    fprintf('Exported %s\n',files(i).name);
end
fid=fopen(fullfile(out,'inventory.json'),'w'); fwrite(fid,jsonencode(inventory,PrettyPrint=true),'char'); fclose(fid);
