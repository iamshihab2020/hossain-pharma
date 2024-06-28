import { Outlet } from "react-router-dom";
import Dashboard_Drawer from "../Dashboard_Drawer/Dashboard_Drawer";
import Dashboard_Drawer_lg from "../Dashboard_Drawer_lg/Dashboard_Drawer_lg";
import SyncHelmet from "../../../pages/Shared/Helmet/SyncHelmet";


const Dashboard = () => {
  //#1F2B5B
  //#3DBDEC
  return (
    <div className="flex">
      <SyncHelmet loc={"Dashboard"}/>
      <div>
        <div className="min-h-screen hidden lg:block ">
          <Dashboard_Drawer_lg/>
        </div>
        
        <div className="min-h-screen lg:hidden">
          <Dashboard_Drawer />
        </div>
      </div>

      <div className="w-full p-5 lg:p-10">
        <Outlet />
      </div>
    </div>
  );
};

export default Dashboard;

