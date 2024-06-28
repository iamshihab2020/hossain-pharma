import SyncHelmet from "../../Shared/Helmet/SyncHelmet"
import Ads from "../Banner/Ads"
import Category from "../Category/Category/Category"
import Discounted from "../Discounted/Discounted/Discounted"
import LatestProducts from "../Latest/LatestProducts/LatestProducts"
import Banner from "../MainBanner/Banner"


const Home = () => {
  return (
    <div className="min-h-screen">
      <SyncHelmet loc={"Home"} />
      <Banner />
      <Ads/>
      <LatestProducts />
      <Category />
      <Discounted/>
      
    </div>
  )
}

export default Home