% Open this file in VS Code, then click Run File (top-right triangle).
% The viewer appears in its own MATLAB window; keep this MATLAB session open.
% Arduino Serial Monitor / Serial Plotter must be closed first.
dashboardFolder = fileparts(mfilename('fullpath'));
addpath(dashboardFolder);
% Re-running this script safely releases the previous dashboard's COM port.
if exist('imuApp','var') && isa(imuApp,'handle') && isvalid(imuApp)
    delete(imuApp);
end
imuApp = ThreeIMUDashboard('COM3',true);
