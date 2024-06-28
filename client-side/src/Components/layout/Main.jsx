import { Outlet } from "react-router-dom"
import Navigation from "../pages/Shared/Navigation/Navigation";
import Footer from "../pages/Shared/Footer/Footer";

const Main = () => {
  return (
    <>
      <Navigation/>
      <Outlet />
      <Footer/>
    </>
  );
}

export default Main